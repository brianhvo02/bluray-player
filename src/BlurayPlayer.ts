import { 
    BDMV_VERSIONS, INDX_SIG1, INDX_ACCESS_PROHIBITED_MASK, INDX_ACCESS_HIDDEN_MASK,
    IndxHdmvPlaybackType, IndxBdjPlaybackType, IndxObjectType,
    type HdmvObject, type BdjObject, type IndexObject, type TitleObject, 
    type BlurayIndex, type BlurayTitle, type BlurayTitleInfo,
} from "./types/BlurayIndex.js";
import { binToStr, readBits } from "./utils.js";

type FileMap = Record<string, File>;

export default class BlurayPlayer {
    files: FileMap;
    index: BlurayIndex;
    titleInfo: BlurayTitleInfo;

    static async load() {
        const input = document.createElement('input');
        input.type = 'file';
        input.webkitdirectory = true;
        const files = await new Promise<FileMap | null>(resolve => {
            input.onchange = () => {
                if (!input.files)
                    return resolve(null);
                const files = [...input.files].reduce((map: FileMap, file) => {
                    map[file.webkitRelativePath.slice(file.webkitRelativePath.indexOf('/'))] = file;
                    return map;
                }, {});

                resolve(files);
            };

            input.click();
        });

        if (!files) return null;

        const indxFile = files['/BDMV/index.bdmv'];
        if (!indxFile)
            throw new Error('No index.bdmv found.');
        const idxArrBuf = await indxFile.arrayBuffer();

        return new this(files, idxArrBuf);
    }

    constructor(files: FileMap, idxArrBuf: ArrayBufferLike) {
        this.files = files;
        const index = this.parseIndex(idxArrBuf);
        if (!index)
            throw new Error('Could not parse index.bdmv.');
        this.index = index;
        // TODO: Check for incomplete disc (bluray.c:1017)
        this.titleInfo = this.generateTitleInfo();
    }

    parseHeader(type: number, view: DataView) {
        const tag = view.getUint32(0),
            ver = view.getUint32(4);

        if (tag !== type) {
            console.error('Invalid header signature.');
            return null;
        }

        if (!BDMV_VERSIONS.includes(ver)) {
            console.error('Unsupported file version.');
            return null;
        }

        return ver;
    }

    _parseHdmvObj(idx: number, view: DataView): HdmvObject | null {
        const [playbackType] = readBits(view.getUint8(idx), [2, 6]);
        const idRef = view.getUint16(idx + 2);
        
        if (!Object.values(IndxHdmvPlaybackType).includes(playbackType)) {
            console.error('Invalid HDMV playback type', playbackType);
            return null;
        }

        return { playbackType, idRef };
    }
    
    _parseBdjObj(idx: number, view: DataView): BdjObject | null {
        const [playbackType] = readBits(view.getUint8(idx), [2, 6]);
        const name = binToStr(view.buffer, idx + 2, 5);
        
        if (!Object.values(IndxBdjPlaybackType).includes(playbackType)) {
            console.error('Invalid BDJ playback type', playbackType);
            return null;
        }

        return { playbackType, name };
    }

    _parsePlaybackObj(idx: number, view: DataView): IndexObject | null {
        const [objectType] = readBits(view.getUint8(idx), [2, 6]);
        
        switch (objectType) {
            case IndxObjectType.HDMV:
                const hdmv = this._parseHdmvObj(idx + 4, view);
                return hdmv ? { objectType, hdmv } : null;
            case IndxObjectType.BDJ:
                const bdj = this._parseBdjObj(idx + 4, view);
                return bdj ? { objectType, bdj } : null;
            default:
                console.error('Unknown object type:', objectType);
                return null;
        }
    }

    parseIndex(arrBuf: ArrayBufferLike): BlurayIndex | null {
        const dataView = new DataView(arrBuf);

        const indxVersion = this.parseHeader(INDX_SIG1, dataView);
        if (!indxVersion)
            return null;

        const indexStart = dataView.getUint32(8);
        // const extensionDataStart = dataView.getUint32(12);

        const appInfoLength = dataView.getUint32(40);
        if (appInfoLength !== 34)
            console.error(`App info length is ${appInfoLength}, expected 34.`);

        const [
            , initialOutputModePreference, contentExistFlag,, initialDynamicRangeType
        ] = readBits(dataView.getUint8(44), [1, 1, 1, 1, 4]);

        const [videoFormat, frameRate] = readBits(dataView.getUint8(45), [4, 4]);
        const userData = arrBuf.slice(46, 78);

        const appInfo = { 
            initialOutputModePreference, contentExistFlag, initialDynamicRangeType,
            videoFormat, frameRate, userData,
        };

        const indexLen = dataView.getUint32(indexStart);
        if (arrBuf.byteLength - indexStart < indexLen) {
            console.error('Invalid index_len', indexLen);
            return null;
        }

        const firstPlay = this._parsePlaybackObj(indexStart + 4, dataView);
        if (!firstPlay) return null;
        
        const topMenu = this._parsePlaybackObj(indexStart + 16, dataView);
        if (!topMenu) return null;

        const numTitles = dataView.getUint16(indexStart + 28);
        const titles: TitleObject[] = [];
        if (!numTitles) {
            if (firstPlay.objectType == IndxObjectType.HDMV && firstPlay.hdmv?.idRef == 0xffff && 
                topMenu.objectType == IndxObjectType.HDMV && topMenu.hdmv?.idRef == 0xffff) {
                console.error('Empty index.');
                return null;
            }

            return { indxVersion, appInfo, firstPlay, topMenu, titles };
        }
        for (let i = 0; i < numTitles; i++) {
            const [objectType, accessType] = readBits(dataView.getUint8(indexStart + 30 + i * 12), [2, 2, 4]);
                switch (objectType) {
                case IndxObjectType.HDMV:
                    const hdmv = this._parseHdmvObj(indexStart + 34 + i * 12, dataView);
                    if (!hdmv) return null;
                    titles.push({ objectType, accessType, hdmv });
                    break;
                case IndxObjectType.BDJ:
                    const bdj = this._parseBdjObj(indexStart + 34 + i * 12, dataView);
                    if (!bdj) return null;
                    titles.push({ objectType, accessType, bdj });
                    break;
                default:
                    console.error('Unknown object type:', objectType);
                    return null;
            }
        }

        return { indxVersion, appInfo, firstPlay, topMenu, titles };
    }

    generateTitleInfo(): BlurayTitleInfo {
        const blurayDetected = true;

        const {
            titles: indexedTitles,
            topMenu, firstPlay,
            appInfo: { 
                videoFormat, frameRate, initialDynamicRangeType, contentExistFlag: contentExist3D,
                initialOutputModePreference, userData: providerData,
            },
        } = this.index;

        let numHdmvTitles = 0;
        let numBdjTitles = 0;
        let bdjDetected = false;

        const titles = indexedTitles.map<BlurayTitle>(({ objectType, accessType, hdmv, bdj }) => {
            if (objectType === IndxObjectType.HDMV) {
                if (!hdmv) 
                    throw new Error('HDMV Object type mismatch.');
                numHdmvTitles++;
                
                return {
                    bdj: false,
                    idRef: hdmv.idRef,
                    interactive: hdmv.playbackType === IndxHdmvPlaybackType.INTERACTIVE,
                    accessible: !(accessType & INDX_ACCESS_PROHIBITED_MASK),
                    hidden: Boolean(accessType & INDX_ACCESS_HIDDEN_MASK),
                };
            }
            
            if (!bdj) 
                throw new Error('BDJ Object type mismatch.');
            bdjDetected = true;
            numBdjTitles++;

            return {
                bdj: true,
                idRef: parseInt(bdj.name),
                interactive: bdj.playbackType === IndxBdjPlaybackType.INTERACTIVE,
                accessible: !(accessType & INDX_ACCESS_PROHIBITED_MASK),
                hidden: Boolean(accessType & INDX_ACCESS_HIDDEN_MASK),
            };
        });

        if (firstPlay.objectType === IndxObjectType.BDJ && firstPlay.bdj) {
            bdjDetected = true;
            titles.push({
                bdj: true,
                interactive: firstPlay.bdj.playbackType === IndxBdjPlaybackType.INTERACTIVE,
                idRef: parseInt(firstPlay.bdj.name),
                accessible: false,
                hidden: true,
            });
        }
        if (firstPlay.objectType === IndxObjectType.HDMV && firstPlay.hdmv && firstPlay.hdmv.idRef !== 0xffff) {
            titles.push({
                bdj: false,
                interactive: firstPlay.hdmv.playbackType === IndxHdmvPlaybackType.INTERACTIVE,
                idRef: firstPlay.hdmv.idRef,
                accessible: false,
                hidden: true,
            });
        }

        if (topMenu.objectType === IndxObjectType.BDJ && topMenu.bdj) {
            bdjDetected = true;
            titles.push({
                bdj: true,
                interactive: topMenu.bdj.playbackType === IndxBdjPlaybackType.INTERACTIVE,
                idRef: parseInt(topMenu.bdj.name),
                accessible: false,
                hidden: false,
            });
        }
        if (topMenu.objectType === IndxObjectType.HDMV && topMenu.hdmv && topMenu.hdmv.idRef !== 0xffff) {
            titles.unshift({
                bdj: false,
                interactive: topMenu.hdmv.playbackType === IndxHdmvPlaybackType.INTERACTIVE,
                idRef: topMenu.hdmv.idRef,
                accessible: false,
                hidden: false,
            });
        }

        const firstPlaySupported = firstPlay.objectType === IndxObjectType.HDMV && firstPlay.hdmv && firstPlay.hdmv.idRef != 0xffff;
        // if (firstPlay.objectType === IndxObjectType.BDJ)
            // bd->disc_info.first_play_supported = bd->disc_info.bdj_handled;

        const topMenuSupported = topMenu.objectType === IndxObjectType.HDMV && !!topMenu.hdmv && topMenu.hdmv.idRef != 0xffff;
        // if (topMenu.objectType === IndxObjectType.BDJ)
            // bd->disc_info.top_menu_supported = bd->disc_info.bdj_handled;

        if (firstPlaySupported)
            titles[titles.length - 1].accessible = true;
        if (topMenuSupported)
            titles[0].accessible = true;

        /* TODO: increase player profile and version when 3D or UHD disc is detected (bluray.c:1133) */
        /* TODO: populate title names (bluray.c:1150) */
        
        return { 
            blurayDetected,
            videoFormat, frameRate, initialDynamicRangeType, 
            contentExist3D, initialOutputModePreference, providerData, 
            bdjDetected, titles,
            firstPlay: firstPlaySupported ? titles[titles.length - 1] : null,
            topMenu: topMenuSupported ? titles[0] : null,
            noMenuSupport: !firstPlaySupported || !topMenuSupported,
        };
    }
}