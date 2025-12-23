import BlurayRegister, { BdPsrEventType, PsrIdx, type BdPsrEvent } from './BlurayRegister.js';
import { BdEventE } from './types/BlurayEvents.js';
import { 
    BDMV_VERSIONS, INDX_SIG1, INDX_ACCESS_PROHIBITED_MASK, INDX_ACCESS_HIDDEN_MASK,
    IndxHdmvPlaybackType, IndxBdjPlaybackType, TitleType,
    type HdmvObject, type BdjObject, type IndexObject, type TitleObject, 
    type BlurayIndex, type BlurayTitle
} from "./types/BlurayIndex.js";
import { binToStr, readBits } from "./utils.js";

type FileMap = Record<string, File>;

/* BD_EVENT_TITLE special titles */
const BLURAY_TITLE_FIRST_PLAY  = 0xffff;   /**< "First Play" title started        */
const BLURAY_TITLE_TOP_MENU    = 0;        /**< "Top Menu" title started          */

export interface BdEvent {
    event: number;
    param: number;
}

interface DiscInfo {
    blurayDetected: boolean;    /**< 1 if BluRay disc was detected */

    /* Disc ID */
    discName?: string;          /**< optional disc name in preferred language */
    udfVolumeId?: string;       /**< optional UDF volume identifier */
    discId?: ArrayBufferLike;           /**< Disc ID */

    /** HDMV / BD-J titles */
    noMenuSupport: boolean;            /**< 1 if this disc can't be played using on-disc menus */
    firstPlaySupported: boolean;       /**< 1 if First Play title is present on the disc and can be played */
    topMenuSupported: boolean;         /**< 1 if Top Menu title is present on the disc and can be played */

    numTitles: number;               /**< number of titles on the disc, not including "First Play" and "Top Menu" */
    titles: BlurayTitle[];            /**< index is title number 1 ... N */
    firstPlay: BlurayTitle | null;    /**< titles[N+1].   NULL if not present on the disc. */
    topMenu: BlurayTitle | null;      /**< titles[0]. NULL if not present on the disc. */

    numHdmvTitles: number;            /**< number of HDMV titles */
    numBdjTitles: number;             /**< number of BD-J titles */
    numUnsupportedTitles: number;     /**< number of unsupported titles */

    /** BD-J info (valid only if disc uses BD-J) */
    bdjDetected?: boolean;     /**< 1 if disc uses BD-J */
    libjvmDetected?: boolean;  /**< 1 if usable Java VM was found */
    bdjHandled?: boolean;      /**< 1 if usable Java VM + libbluray.jar was found */

    bdjOrgId?: string[];        /**< (BD-J) disc organization ID */
    bdjDiscId?: string[];       /**< (BD-J) disc ID */

    /* disc application info */
    videoFormat: number;                     /**< \ref bd_video_format_e */
    frameRate: number;                       /**< \ref bd_video_rate_e */
    contentExist3D: number;                  /**< 1 if 3D content exists on the disc */
    initialOutputModePreference: number;     /**< 0 - 2D, 1 - 3D */
    providerData: ArrayBufferLike;              /**< Content provider data */

    /* AACS info  (valid only if disc uses AACS) */
    aacsDetected?: number;     /**< 1 if disc is using AACS encoding */
    libaacsDetected?: number;  /**< 1 if usable AACS decoding library was found */
    aacsHandled?: number;      /**< 1 if disc is using supported AACS encoding */

    aacsErrorCode?: number;   /**< AACS error code (BD_AACS_*) */
    aacsMkbv?: number;         /**< AACS MKB version */

    /* BD+ info  (valid only if disc uses BD+) */
    bdplusDetected?: boolean;     /**< 1 if disc is using BD+ encoding */
    libbdplusDetected?: boolean;  /**< 1 if usable BD+ decoding library was found */
    bdplusHandled?: boolean;      /**< 1 if disc is using supporred BD+ encoding */

    bdplusGen?: number;          /**< BD+ content code generation */
    bdplusDate?: number;         /**< BD+ content code relese date ((year<<16)|(month<<8)|day) */

    /* disc application info (libbluray > 1.2.0) */
    initialDynamicRangeType: number; /**< bd_dynamic_range_type_e */
}

export default class BlurayPlayer extends EventTarget {
    files: FileMap;
    regs: BlurayRegister;
    index: BlurayIndex;
    discInfo: DiscInfo;
    titleType = TitleType.UNDEF;

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
        super();

        this.files = files;

        // bd_init
        this.regs = new BlurayRegister();
        // TODO: Check LIBBLURAY_PERSISTENT_STORAGE (bluray.c:1482)

        // bd_open
        const index = this.parseIndex(idxArrBuf);
        if (!index)
            throw new Error('Could not parse index.bdmv.');
        this.index = index;
        // TODO: Check for incomplete disc (bluray.c:1017)
        this.discInfo = this.generateDiscInfo();
        // TODO: Check for AACS and BD+ (vlc/bluray.c:897)
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
            case TitleType.HDMV:
                const hdmv = this._parseHdmvObj(idx + 4, view);
                return hdmv ? { objectType, hdmv } : null;
            case TitleType.BDJ:
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
            if (firstPlay.objectType == TitleType.HDMV && firstPlay.hdmv?.idRef == 0xffff && 
                topMenu.objectType == TitleType.HDMV && topMenu.hdmv?.idRef == 0xffff) {
                console.error('Empty index.');
                return null;
            }

            return { indxVersion, appInfo, firstPlay, topMenu, titles };
        }
        for (let i = 0; i < numTitles; i++) {
            const [objectType, accessType] = readBits(dataView.getUint8(indexStart + 30 + i * 12), [2, 2, 4]);
                switch (objectType) {
                case TitleType.HDMV:
                    const hdmv = this._parseHdmvObj(indexStart + 34 + i * 12, dataView);
                    if (!hdmv) return null;
                    titles.push({ objectType, accessType, hdmv });
                    break;
                case TitleType.BDJ:
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

    generateDiscInfo(): DiscInfo {
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
            if (objectType === TitleType.HDMV) {
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

        if (firstPlay.objectType === TitleType.BDJ && firstPlay.bdj) {
            bdjDetected = true;
            titles.push({
                bdj: true,
                interactive: firstPlay.bdj.playbackType === IndxBdjPlaybackType.INTERACTIVE,
                idRef: parseInt(firstPlay.bdj.name),
                accessible: false,
                hidden: true,
            });
        }
        if (firstPlay.objectType === TitleType.HDMV && firstPlay.hdmv && firstPlay.hdmv.idRef !== 0xffff) {
            titles.push({
                bdj: false,
                interactive: firstPlay.hdmv.playbackType === IndxHdmvPlaybackType.INTERACTIVE,
                idRef: firstPlay.hdmv.idRef,
                accessible: false,
                hidden: true,
            });
        }

        if (topMenu.objectType === TitleType.BDJ && topMenu.bdj) {
            bdjDetected = true;
            titles.push({
                bdj: true,
                interactive: topMenu.bdj.playbackType === IndxBdjPlaybackType.INTERACTIVE,
                idRef: parseInt(topMenu.bdj.name),
                accessible: false,
                hidden: false,
            });
        }
        if (topMenu.objectType === TitleType.HDMV && topMenu.hdmv && topMenu.hdmv.idRef !== 0xffff) {
            titles.unshift({
                bdj: false,
                interactive: topMenu.hdmv.playbackType === IndxHdmvPlaybackType.INTERACTIVE,
                idRef: topMenu.hdmv.idRef,
                accessible: false,
                hidden: false,
            });
        }

        const firstPlaySupported = firstPlay.objectType === TitleType.HDMV && !!firstPlay.hdmv && firstPlay.hdmv.idRef != 0xffff;
        // if (firstPlay.objectType === TitleType.BDJ)
            // bd->disc_info.first_play_supported = bd->disc_info.bdj_handled;

        const topMenuSupported = topMenu.objectType === TitleType.HDMV && !!topMenu.hdmv && topMenu.hdmv.idRef != 0xffff;
        // if (topMenu.objectType === TitleType.BDJ)
            // bd->disc_info.top_menu_supported = bd->disc_info.bdj_handled;

        if (firstPlaySupported)
            titles[titles.length - 1].accessible = true;
        if (topMenuSupported)
            titles[0].accessible = true;

        /* TODO: increase player profile and version when 3D or UHD disc is detected (bluray.c:1133) */
        /* TODO: populate title names (bluray.c:1150) */
        
        return { 
            blurayDetected, bdjDetected,
            videoFormat, frameRate, initialDynamicRangeType, 
            contentExist3D, initialOutputModePreference, providerData, 
            numHdmvTitles, numBdjTitles, numTitles: titles.length, titles,
            numUnsupportedTitles: titles.length - numHdmvTitles - numBdjTitles,
            firstPlaySupported, topMenuSupported,
            firstPlay: firstPlaySupported ? titles[titles.length - 1] : null,
            topMenu: topMenuSupported ? titles[0] : null,
            noMenuSupport: !firstPlaySupported || !topMenuSupported,
        };
    }

    _queueEvent(event: BdEventE, param: number) {
        this.dispatchEvent(new CustomEvent('bd-event', { detail: { event, param } }));
    }

    _processPsrWriteEvent(ev: BdPsrEvent) {
        if (ev.evType == BdPsrEventType.WRITE)
            console.log(`PSR write: psr${ev.psrIdx} = ${ev.newVal}`);

        switch (ev.psrIdx) {

            /* current playback position */

            case PsrIdx.ANGLE_NUMBER:
                // _bdj_event  (bd, BDJ_EVENT_ANGLE,   ev.newVal);
                this._queueEvent(BdEventE.ANGLE, ev.newVal);
                break;
            case PsrIdx.TITLE_NUMBER:
                this._queueEvent(BdEventE.TITLE, ev.newVal);
                break;
            case PsrIdx.PLAYLIST:
                // _bdj_event  (bd, BDJ_EVENT_PLAYLIST,ev.newVal);
                this._queueEvent(BdEventE.PLAYLIST, ev.newVal);
                break;
            case PsrIdx.PLAYITEM:
                // _bdj_event  (bd, BDJ_EVENT_PLAYITEM,ev.newVal);
                this._queueEvent(BdEventE.PLAYITEM, ev.newVal);
                break;
            case PsrIdx.TIME:
                // _bdj_event  (bd, BDJ_EVENT_PTS,     ev.newVal);
                break;

            case 102:
                // _bdj_event  (bd, BDJ_EVENT_PSR102,  ev.newVal);
                break;
            case 103:
                // disc_event(bd->disc, DISC_EVENT_APPLICATION, ev.newVal);
                break;

            default:;
        }
    }

    _processPsrChangeEvent(ev: BdPsrEvent) {
        console.log(`PSR change: psr${ev.psrIdx} = ${ev.newVal}`);
        this._processPsrWriteEvent(ev);

        switch (ev.psrIdx) {
            /* current playback position */

            case PsrIdx.TITLE_NUMBER:
                // disc_event(bd->disc, DISC_EVENT_TITLE, ev.newVal);
                break;

            case PsrIdx.CHAPTER:
                // _bdj_event  (bd, BDJ_EVENT_CHAPTER, ev.newVal);
                if (ev.newVal != 0xffff)
                    this._queueEvent(BdEventE.CHAPTER, ev.newVal);
                break;

            /* stream selection */

            case PsrIdx.IG_STREAM_ID:
                this._queueEvent(BdEventE.IG_STREAM, ev.newVal);
                break;

            case PsrIdx.PRIMARY_AUDIO_ID:
                // _bdj_event(bd, BDJ_EVENT_AUDIO_STREAM, ev.newVal);
                this._queueEvent(BdEventE.AUDIO_STREAM, ev.newVal);
                break;

            case PsrIdx.PG_STREAM:
                // _bdj_event(bd, BDJ_EVENT_SUBTITLE, ev.newVal);
                if ((ev.newVal & 0x80000fff) != (ev.oldVal & 0x80000fff)) {
                    this._queueEvent(BdEventE.PG_TEXTST,        Number(!!(ev.newVal & 0x80000000)));
                    this._queueEvent(BdEventE.PG_TEXTST_STREAM,    ev.newVal & 0xfff);
                }

                // TODO
                // if (bd->st0.clip) {
                //     _init_pg_stream(bd);
                //     if (bd->st_textst.clip) {
                //         BD_DEBUG(DBG_BLURAY | DBG_CRIT, "Changing TextST stream\n");
                //         _preload_textst_subpath(bd);
                //     }
                // }

                break;

            case PsrIdx.SECONDARY_AUDIO_VIDEO:
                /* secondary video */
                if ((ev.newVal & 0x8f00ff00) != (ev.oldVal & 0x8f00ff00)) {
                    this._queueEvent(BdEventE.SECONDARY_VIDEO, Number(!!(ev.newVal & 0x80000000)));
                    this._queueEvent(BdEventE.SECONDARY_VIDEO_SIZE, (ev.newVal >> 24) & 0xf);
                    this._queueEvent(BdEventE.SECONDARY_VIDEO_STREAM, (ev.newVal & 0xff00) >> 8);
                }
                /* secondary audio */
                if ((ev.newVal & 0x400000ff) != (ev.oldVal & 0x400000ff)) {
                    this._queueEvent(BdEventE.SECONDARY_AUDIO, Number(!!(ev.newVal & 0x40000000)));
                    this._queueEvent(BdEventE.SECONDARY_AUDIO_STREAM, ev.newVal & 0xff);
                }
                // _bdj_event(bd, BDJ_EVENT_SECONDARY_STREAM, ev.newVal);
                break;

            /* 3D status */
            case PsrIdx._3D_STATUS:
                this._queueEvent(BdEventE.STEREOSCOPIC_STATUS, ev.newVal & 1);
                break;

            default:;
        }
    }

    _processPsrRestoreEvent(ev: BdPsrEvent) {
        /* PSR restore events are handled internally.
        * Restore stored playback position.
        */

        console.log(`PSR restore: psr${ev.psrIdx} = ${ev.newVal}`);

        switch (ev.psrIdx) {
            case PsrIdx.ANGLE_NUMBER:
                /* can't set angle before playlist is opened */
                return;
            case PsrIdx.TITLE_NUMBER:
                /* pass to the application */
                this._queueEvent(BdEventE.TITLE, ev.newVal);
                return;
            case PsrIdx.CHAPTER:
                /* will be selected automatically */
                return;
            case PsrIdx.PLAYLIST:
                // bd_select_playlist(bd, ev.newVal);
                // nav_set_angle(bd->title, bd_psr_read(bd->regs, PSR_ANGLE_NUMBER) - 1);
                return;
            case PsrIdx.PLAYITEM:
                // bd_seek_playitem(bd, ev.newVal);
                return;
            case PsrIdx.TIME:
                // _clip_seek_time(bd, ev.newVal);
                // _init_ig_stream(bd);
                // _run_gc(bd, GC_CTRL_INIT_MENU, 0);
                return;

            case PsrIdx.SELECTED_BUTTON_ID:
            case PsrIdx.MENU_PAGE_ID:
                /* handled by graphics controller */
                return;

            default:
                /* others: ignore */
                return;
        }
    }


    _processPsrEvent({ detail }: CustomEventInit<BdPsrEvent>) {
        if (!detail) return;

        switch(detail.evType) {
            case BdPsrEventType.WRITE:
                this._processPsrWriteEvent(detail);
                break;
            case BdPsrEventType.CHANGE:
                this._processPsrChangeEvent(detail);
                break;
            case BdPsrEventType.RESTORE:
                this._processPsrRestoreEvent(detail);
                break;
            case BdPsrEventType.SAVE:
                console.log('PSR save event');
                break;
            default:
                console.log(`PSR event ${detail.evType}: psr${detail.psrIdx} = ${detail.newVal}`);
                break;
        }
    }

    _queueInitialPsrEvents() {
        [
            PsrIdx.ANGLE_NUMBER,
            PsrIdx.TITLE_NUMBER,
            PsrIdx.IG_STREAM_ID,
            PsrIdx.PRIMARY_AUDIO_ID,
            PsrIdx.PG_STREAM,
            PsrIdx.SECONDARY_AUDIO_VIDEO,
        ].forEach(psr => this._processPsrChangeEvent({
            evType: BdPsrEventType.CHANGE,
            psrIdx: psr,
            oldVal: 0,
            newVal: 1
        }));
    }

    _playHdmv(idRef: number) {
        // _stop_bdj(bd);

        this.titleType = TitleType.HDMV;

        
    }

    _playTitle(title: number) {
        if (!this.discInfo.titles) {
            console.error(`_playTitle(#${title}): No disc index`);
            return;
        }

        if (this.discInfo.noMenuSupport) {
            console.error('_playTitle(): no menu support');
            return;
        }

        if (title === BLURAY_TITLE_FIRST_PLAY) {
            if (!this.discInfo.firstPlay)
                throw new Error('_playTitle(): Expected first play title when none exists');

            this.regs.psrWrite(PsrIdx.TITLE_NUMBER, BLURAY_TITLE_FIRST_PLAY); /* 5.2.3.3 */

            if (!this.discInfo.firstPlaySupported) {
                /* no first play title (5.2.3.3) */
                this.titleType = TitleType.HDMV;
                throw new Error('_playTitle(): No first play title');
            }

            if (this.discInfo.firstPlay?.bdj) {
                // return _playBdj(title);
                throw new Error('BDJ not supported.');
            } else {
                return this._playHdmv(this.discInfo.firstPlay.idRef);
            }
        }

        /* bd_play not called ? */
        if (this.titleType == TitleType.UNDEF) {
            console.error('bd_call_title(): bd_play() not called!');
            return;
        }

        /* top menu ? */
        if (title == BLURAY_TITLE_TOP_MENU) {
            if (!this.discInfo.topMenuSupported) {
                /* no top menu (5.2.3.3) */
                console.error('_play_title(): No top menu title');
                this.titleType = TitleType.HDMV;
                return 0;
            }
        }

        /* valid title from disc index ? */
        if (title <= this.discInfo.numTitles) {
            this.regs.psrWrite(PsrIdx.TITLE_NUMBER, title); /* 5.2.3.3 */
            if (this.discInfo.titles[title].bdj) {
                // return _playBdj(title);
                throw new Error('BDJ not supported.');
            } else {
                return this._playHdmv(this.discInfo.titles[title].idRef);
            }
        } else {
            console.error(`_play_title(#${title}): Title not found`);
        }
    }

    play() {
        this.titleType = TitleType.UNDEF;
        this.regs.addEventListener('change', this._processPsrEvent);
        this._queueInitialPsrEvents();
        this._playTitle(BLURAY_TITLE_FIRST_PLAY);
    }
}