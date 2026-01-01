import BlurayRegister, { BdPsrEventType, PSR_FLAG, PsrIdx, type BdPsrEvent } from './BlurayRegister.js';
import { BdEventE, HdmvEventE, type BdEvent, type HdmvEvent } from './BlurayEvents.js';
import { 
    BDMV_VERSIONS, INDX_SIG1, INDX_ACCESS_PROHIBITED_MASK, INDX_ACCESS_HIDDEN_MASK, MOBJ_SIG1,
    BLURAY_TITLE_FIRST_PLAY, BLURAY_TITLE_TOP_MENU,
    IndxHdmvPlaybackType, IndxBdjPlaybackType, TitleType,
    BlurayError,
    MAX_LOOP,
    MPLS_SIG1,
} from "./consts.js";
import { binToStr, numToHex, readBits } from "./utils.js";
import { HdmvInsnCmp, HdmvInsnGoto, HdmvInsnGrp, HdmvInsnGrpBranch, HdmvInsnGrpSet, HdmvInsnJump, HdmvInsnPlay, HdmvInsnSet, HdmvInsnSetsystem, hdmvInsnValue } from './BlurayHdmvInsn.js';
import { uoMaskParse } from './UoMask.js';

export default class BlurayPlayer extends EventTarget {
    /* current disc */
    disc: FileMap;
    index: BlurayIndex;
    discInfo: DiscInfo;
    titleType = TitleType.UNDEF;
    titleList: NavTitleList | null = null;

    /* current playlist */
    title: NavTitle | null = null;
    titleIdx: number = 0;
    sPos: bigint = 0n;

    /* player state */
    regs: BlurayRegister;   /* player registers */
    uoMask = 0;             /* Current UO mask */

    pc = 0; /* program counter */
    object: MobjObject | null = null; /* currently running object code */
    movieObjects: MobjObjects | null = null; /* disc movie objects */
    igObject: MobjObject | null = null; /* current object from IG stream */

    /* object currently playing playlist */
    playingObject: MobjObject | null = null;
    playingPc = 0; /* program counter */

    /* suspended object */
    suspendedObject: MobjObject | null = null;
    suspendedPc = 0;

    /* HDMV */
    hdmvSuspended = true;

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

        this.disc = files;

        // bd_init
        this.regs = new BlurayRegister();
        // TODO: Check LIBBLURAY_PERSISTENT_STORAGE (bluray.c:1482)

        // bd_open
        const index = this.indexParse(idxArrBuf);
        if (!index)
            throw new Error('Could not parse index.bdmv.');
        this.index = index;
        // TODO: Check for incomplete disc (bluray.c:1017)
        this.discInfo = this.generateDiscInfo();
        // TODO: Check for AACS and BD+ (vlc/bluray.c:897)
    }

    static parseHeader(type: number, view: DataView) {
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

    private _parseHdmvObj(idx: number, view: DataView): HdmvObject | null {
        const [playbackType] = readBits(view.getUint8(idx), [2, 6]);
        const idRef = view.getUint16(idx + 2);
        
        if (!Object.values(IndxHdmvPlaybackType).includes(playbackType)) {
            console.error('Invalid HDMV playback type', playbackType);
            return null;
        }

        return { playbackType, idRef };
    }
    
    private _parseBdjObj(idx: number, view: DataView): BdjObject | null {
        const [playbackType] = readBits(view.getUint8(idx), [2, 6]);
        const name = binToStr(view.buffer, idx + 2, 5);
        
        if (!Object.values(IndxBdjPlaybackType).includes(playbackType)) {
            console.error('Invalid BDJ playback type', playbackType);
            return null;
        }

        return { playbackType, name };
    }

    private _parsePlaybackObj(idx: number, view: DataView): IndexObject | null {
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

    indexParse(arrBuf: ArrayBufferLike): BlurayIndex | null {
        const dataView = new DataView(arrBuf);

        const indxVersion = BlurayPlayer.parseHeader(INDX_SIG1, dataView);
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

    private _queueEvent(event: BdEventE, param: number) {
        this.dispatchEvent(new CustomEvent<BdEvent>('bd-event', { detail: { event, param } }));
    }

    private _processPsrWriteEvent(ev: BdPsrEvent) {
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

    private _processPsrChangeEvent(ev: BdPsrEvent) {
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
                //     private _init_pg_stream(bd);
                //     if (bd->st_textst.clip) {
                //         BD_DEBUG(DBG_BLURAY | DBG_CRIT, "Changing TextST stream\n");
                //         private _preload_textst_subpath(bd);
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

    private _processPsrRestoreEvent(ev: BdPsrEvent) {
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


    private _processPsrEvent({ detail }: CustomEventInit<BdPsrEvent>) {
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

    private _queueInitialPsrEvents() {
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
            newVal: this.regs.psrRead(psr),
        }));
    }

    async mobjGet(): Promise<MobjObjects | null> {
        const file = this.disc['/BDMV/MovieObject.bdmv'] ?? this.disc['/BDMV/BACKUP/MovieObject.bdmv'];
        const buf = await file.arrayBuffer();
        const dataView = new DataView(buf);
        const mobjVersion = BlurayPlayer.parseHeader(MOBJ_SIG1, dataView);
        if (!mobjVersion) {
            console.error('MovieObject.bdmv: invalid header');
            return null;
        }

        const extensionDataStart = dataView.getUint32(8);
        if (extensionDataStart)
            console.error('MovieObject.bdmv: unknown extension data at', extensionDataStart);

        // const dataLen = dataView.getUint32(40);
        const numObjects = dataView.getUint16(48);
        const objects: MobjObject[] = [];

        let ptr = 50;
        for (let i = 0; i < numObjects; i++) {
            const [
                resumeIntentionFlag, menuCallMask, titleSearchMask,
            ] = readBits(dataView.getUint8(ptr), [1, 1, 1, 5]).map(v => !!v);

            const numCmds = dataView.getUint16(ptr + 2);
            if (!numCmds) {
                console.error('MovieObject.bdmv: empty object');
                return null;
            }

            const cmds: MobjCmd[] = [];
            for (let j = 0; j < numCmds; j++) {
                const [
                    opCnt, grp, subGrp, 
                    immOp1, immOp2, reserved1, branchOpt, 
                    reserved2, cmpOpt, 
                    reserved3, setOpt,
                ] = readBits(
                    dataView.getUint32(ptr + 4 + j * 12), 
                    [3, 2, 3, 1, 1, 2, 4, 4, 4, 3, 5]
                );
                const dst = dataView.getUint32(ptr + 8 + j * 12);
                const src = dataView.getUint32(ptr + 12 + j * 12);

                cmds.push({
                    insn: {
                        opCnt, grp, subGrp, 
                        immOp1, immOp2, reserved1, branchOpt, 
                        reserved2, cmpOpt, 
                        reserved3, setOpt,
                    }, dst, src,
                });
            }

            objects.push({
                resumeIntentionFlag, menuCallMask, titleSearchMask,
                numCmds, cmds,
            });

            ptr += 4 + numCmds * 12;
        }

        return { mobjVersion, numObjects, objects };
    }

    private _queueEventHdmv(event: HdmvEventE, param1: number, param2: number) {
        this.dispatchEvent(new CustomEvent<HdmvEvent>('hdmv-event', { detail: { event, param1, param2 } }));
    }

    private _isValidTitle(title: number) {
        if (title === 0)
            return this.discInfo.topMenuSupported;
        if (title === 0xffff)
            return this.discInfo.firstPlaySupported;
        return title > 0 && title <= this.discInfo.numTitles;
    }
    
    private _resumeFromPlayPl() {
        if (!this.playingObject) {
            console.error('_resume_from_play_pl(): object not playing playlist!');
            return -1;
        }

        this.object = this.playingObject;
        this.pc     = this.playingPc + 1;

        this.playingObject = null;
        this.igObject = null

        return 0;
    }

    private _suspendObject(psrBackup: number) {
        console.log('_suspend_object()');

        if (this.suspendedObject)
            console.log('_suspend_object: object already suspended!');

        if (psrBackup) 
            this.regs.psrSaveState();

        if (this.igObject) {
            if (!this.playingObject) {
                console.error('_suspend_object: IG object tries to suspend, no playing object!');
                return;
            }
            this.suspendedObject = this.playingObject;
            this.suspendedPc     = this.playingPc;

            this.playingObject = null;
        } else {
            if (this.playingObject) {
                console.error('_suspend_object: Movie object tries to suspend, also playing object present!');
                return;
            }

            this.suspendedObject = this.object;
            this.suspendedPc     = this.pc;
        }

        this.object = null;
    }

    private _resumeObject(psrRestore: number) {
        if (!this.suspendedObject) {
            console.error('_resume_object: no suspended object!');
            return -1;
        }

        this.object = null;
        this.playingObject = null;

        if (psrRestore) {
            if (this.suspendedObject) {
                const insn = this.suspendedObject.cmds[this.suspendedPc].insn;
                const playPl = (insn.grp     == HdmvInsnGrp.BRANCH &&
                                insn.subGrp  == HdmvInsnGrpBranch.PLAY  &&
                                ( insn.branchOpt == HdmvInsnPlay.PLAY_PL ||
                                  insn.branchOpt == HdmvInsnPlay.PLAY_PL_PI ||
                                  insn.branchOpt == HdmvInsnPlay.PLAY_PL_PM));
                if (playPl) {
                    console.log('resuming playlist playback');
                    this.playingObject = this.suspendedObject;
                    this.playingPc = this.suspendedPc;
                    this.suspendedObject = null;
                    this.regs.psrRestoreState();

                    return 0;
                }
            }
        }

        this.object = this.suspendedObject;
        this.pc = this.suspendedPc + 1;

        this.suspendedObject = null;
        this._queueEventHdmv(HdmvEventE.PLAY_STOP, 0, 0);

        return 0;
    }

    private _jumpObject(object: number) {
        if (!this.movieObjects) {
            console.error('_jump_object(): movie objects not initialized');
            return -1;
        }

        if (object >= this.movieObjects.numObjects) {
            console.error('_jump_object(): invalid object', object);
            return -1;
        }

        console.log('jump_object(): jumping to object', object);

        this._queueEventHdmv(HdmvEventE.PLAY_STOP, 0, 0);
        this.playingObject = null;
        this.pc = 0;
        this.object = this.movieObjects.objects[object];

        return 0;
    }

    private _jumpTitle(title: number) {
        if (!this._isValidTitle(title)) {
            console.error(`_call_title(${title}): invalid title number`);
            return -1;
        }

        console.log(`_call_title(${title})`);
        this.suspendedObject = null;
        this.playingObject = null;
        this._queueEventHdmv(HdmvEventE.TITLE, title, 0);

        return 0;
    }

    private _callObject(object: number) {
        if (!this.movieObjects) {
            console.error('_jump_object(): movie objects not initialized');
            return -1;
        }

        if (object >= this.movieObjects.numObjects) {
            console.error('_jump_object(): invalid object', object);
            return -1;
        }

        console.log(`_call_object(${object})`);
        this._suspendObject(1);
        return this._jumpObject(object);
    }

    private _callTitle(title: number) {
        if (!this._isValidTitle(title)) {
            console.error(`_call_title(${title}): invalid title number`);
            return -1;
        }

        console.log(`_call_title(${title})`);
        this._suspendObject(1);
        this._queueEventHdmv(HdmvEventE.TITLE, title, 0);
        return 0;
    }

    private _playAt(playlist: number, playitem: number, playmark: number) {
        if (this.igObject) {
            console.error(`play_at(list ${playlist}, item ${playitem}, mark ${playmark}): playlist change not allowed in interactive composition`);
            return -1;
        }

        console.log(`play_at(list ${playlist}, item ${playitem}, mark ${playmark})`);
        if (playitem >= 0)
            this._queueEventHdmv(HdmvEventE.PLAY_PL_PI, playlist, playitem);
        else if (playmark >= 0)
            this._queueEventHdmv(HdmvEventE.PLAY_PL_PM, playlist, playmark);
        else
            this._queueEventHdmv(HdmvEventE.PLAY_PL, playlist, 0);

        if (this.playingObject) {
            console.error('_suspend_for_play_pl(): object already playing playlist!');
            return -1;
        }

        this.playingObject = this.object;
        this.playingPc = this.pc;

        this.object = null;

        return 0;
    }

    private _linkAt(playitem: number, playmark: number) {
        if (!this.igObject) {
            console.error(`link_at(item ${playitem}, mark ${playmark}): link commands not allowed in movie objects`);
            return -1;
        }

        if (playitem >= 0) {
            console.log(`link_at(playitem ${playitem})`);
            this._queueEventHdmv(HdmvEventE.PLAY_PI, playitem, 0);
        } else if (playmark >= 0) {
            console.log(`link_at(playmark ${playmark})`);
            this._queueEventHdmv(HdmvEventE.PLAY_PM, playmark, 0);
        }

        return 0;
    }

    private _playStop() {
        if (!this.igObject) {
            console.error(`_play_stop() not allowed in movie object`);
            return -1;
        }

        console.log('_play_stop()');
        this._queueEventHdmv(HdmvEventE.PLAY_STOP, 0, 0);

        if (this._resumeFromPlayPl() < 0) {
            console.error('_play_top(): resuming movie object failed!');
            return -1;
        }

        return 0;
    }

    private _setStream(dst: number, src: number) {
        console.log(`_set_stream(0x${numToHex(dst, 4)}, 0x${numToHex(src, 4)})`);

        /* primary audio stream */
        if (dst & 0x80000000)
            this.regs.psrWrite(PsrIdx.PRIMARY_AUDIO_ID, (dst >> 16) & 0xfff);

        /* IG stream */
        if (src & 0x80000000)
            this.regs.psrWrite(PsrIdx.IG_STREAM_ID, (src >> 16) & 0xff);

        /* angle number */
        if (src & 8000)
            this.regs.psrWrite(PsrIdx.ANGLE_NUMBER, src & 0xff);

        /* PSR2 */
        let psr2 = this.regs.psrRead(PsrIdx.PG_STREAM);

        /* PG TextST stream number */
        if (dst & 0x8000) {
            const textStNum = dst & 0xfff;
            psr2 = textStNum | ((psr2 & 0xfffff000) >>> 0);
        }

        /* Update PG TextST stream display flag */
        const dispSFlag = ((dst & 0x4000) << 17) >>> 0;
        psr2 = dispSFlag | ((psr2 & 0x7fffffff) >>> 0);

        this.regs.psrWrite(PsrIdx.PG_STREAM, psr2);
    }

    private _setSecStream(dst: number, src: number) {
        console.log(`_set_sec_stream(0x${numToHex(dst, 4)}, 0x${numToHex(src, 4)})`);

        const dispVFlag   = (dst >> 30) & 1;
        const dispAFlag   = (src >> 30) & 1;
        const textStFlags = (src >> 13) & 3;

        /* PSR14 */
        let psr14 = this.regs.psrRead(PsrIdx.SECONDARY_AUDIO_VIDEO);

        /* secondary video */
        if (dst & 0x80000000) {
            const secVideo = dst & 0xff;
            psr14 = (secVideo << 8) | ((psr14 & 0xffff00ff) >>> 0);
        }

        /* secondary video size */
        if (dst & 0x00800000) {
            const videoSize = (dst >> 16) & 0xf;
            psr14 = (videoSize << 24) | ((psr14 & 0xf0ffffff) >>> 0);
        }

        /* secondary audio */
        if (src & 0x80000000) {
            const secAudio = (src >> 16) & 0xff;
            psr14 = secAudio | ((psr14 & 0xffffff00) >>> 0);
        }

        psr14 = (dispVFlag << 31) | ((psr14 & 0x7fffffff) >>> 0);
        psr14 = (dispAFlag << 30) | ((psr14 & 0xbfffffff) >>> 0);

        this.regs.psrWrite(PsrIdx.SECONDARY_AUDIO_VIDEO, psr14);

        /* PSR2 */
        let psr2 = this.regs.psrRead(PsrIdx.PG_STREAM);

        /* PiP PG TextST stream */
        if (src & 0x8000) {
            const stream = src & 0xfff;
            psr2 = (stream << 16) | ((psr2 & 0xf000ffff) >>> 0);
        }

        psr2 = (textStFlags << 30) | ((psr2 & 0x3fffffff) >>> 0);

        this.regs.psrWrite(PsrIdx.PG_STREAM, psr2);
    }

    private _setStreamSs(dst: number, src: number) {
        console.log(`_set_stream_ss(0x${numToHex(dst, 4)}, 0x${numToHex(src, 4)})`);

        if (!(this.regs.psrRead(PsrIdx._3D_STATUS) & 1)) {
            console.log('_set_stream_ss ignored (PSR22 indicates 2D mode)');
            return;
        }

        console.log(`_set_stream_ss(0x${numToHex(dst, 4)}, 0x${numToHex(src, 4)}) unimplemented`);
    }

    private _setsystem0x10(dst: number, src: number) {
        console.log(`_set_psr103(0x${numToHex(dst, 4)}, 0x${numToHex(src, 4)})`);

        /* just a guess ... */
        // this.regs.psrWrite(104, 0);
        this.regs.psrWrite(103, dst);
    }

    private _setButtonPage(dst: number, src: number) {
        if (this.igObject) {
            const param =  ((src & 0xc0000000) >>> 0) |        /* page and effects flags */
                          (((dst & 0x80000000) >>> 0) >>  2) | /* button flag */
                          (((src & 0x000000ff) >>> 0) << 16) | /* page id */
                           (dst & 0x0000ffff);                 /* button id */
            
            this._queueEventHdmv(HdmvEventE.SET_BUTTON_PAGE, param, 0);

            /* terminate */
            this.pc = 1 << 17;

            return;
        }

        /* selected button */
        if ((dst & 0x80000000) >>> 0) {
            this.regs.psrWrite(PsrIdx.SELECTED_BUTTON_ID, dst & 0xffff);
        }

        /* active page */
        if ((src & 0x80000000) >>> 0) {
            this.regs.psrWrite(PsrIdx.MENU_PAGE_ID, src & 0xff);
        }
    }

    private _enableButton(dst: number, enable: number) {
        /* not valid in movie objects */
        if (!this.igObject)
            return;

        this._queueEventHdmv(enable ? HdmvEventE.ENABLE_BUTTON : HdmvEventE.DISABLE_BUTTON,  dst, 0);
    }

    private _setStillMode(enable: number) {
        /* not valid in movie objects */
        if (!this.igObject)
            return;

        this._queueEventHdmv(HdmvEventE.STILL, enable, 0);
    }

    private _popupOff() {
        /* not valid in movie objects */
        if (!this.igObject)
            return;

        this._queueEventHdmv(HdmvEventE.POPUP_OFF, 1, 0);
    }

    private _setOutputMode(dst: number) {
        if ((this.regs.psrRead(PsrIdx.PROFILE_VERSION) & 0x130240) != 0x130240) {
            console.log('_set_output_mode ignored (not running as profile 5 player)');
            return;
        }
        
        let psr22 = this.regs.psrRead(PsrIdx._3D_STATUS);

        /* update output mode (bit 0). PSR22 bits 1 and 2 are subtitle alignment (_set_stream_ss()) */
        if (dst & 1) {
            psr22 |= 1;
        } else {
            psr22 &= ~1;
        }

        this.regs.psrWrite(PsrIdx._3D_STATUS, psr22);
    }

    // _setNvTimer(dst: number, src: number) {
    //     if (!this.movieObjects) {
    //         console.error('_set_nv_timer(): movie objects not initialized');
    //         return;
    //     }

    //     const mobjId  = dst & 0xffff;
    //     const timeout = src & 0xffff;

    //     if (!timeout) {
    //         /* cancel timer */
    //         this.nvTimer.time = 0;
    //         this.regs.psrWrite(PsrIdx.NAV_TIMER, 0);
    //         return;
    //     }

    //     /* validate params */
    //     if (mobjId >= this.movieObjects.numObjects) {
    //         console.error(`_set_nv_timer(): invalid object id (${mobjId})!`);
    //         return;
    //     }
    //     if (timeout > 300) {
    //         console.error(`_set_nv_timer(): invalid timeout (${timeout})!`);
    //         return;
    //     }

    //     console.error('_set_nv_timer(): navigation timer not implemented!');

    //     /* set expiration time */
    //     this.nvTimer.time = time(NULL);
    //     this.nvTimer.time += timeout;

    //     this.nvTimer.mobjId = mobjId;

    //     bd_psr_write(this.regs, PSR_NAV_TIMER, timeout);
    // }

    hdmvVmSelectObject(object: number) {
        return this._jumpObject(object);
    }

    async _playHdmv(idRef: number) {
        // _stop_bdj(bd);

        this.titleType = TitleType.HDMV;
        
        
        if (!this.movieObjects) {
            const movieObjects = await this.mobjGet();
            if (!movieObjects)
                return 1;

            this.movieObjects = movieObjects;
        }


        const result = this.hdmvVmSelectObject(idRef);

        this.hdmvSuspended = !this.object;

        if (result) {
            this.titleType = TitleType.UNDEF;
            this._queueEvent(BdEventE.ERROR, BlurayError.HDMV);
        }

        return result;
    }

    async _playTitle(title: number) {
        if (!this.discInfo.titles) {
            console.error(`_playTitle(#${title}): No disc index`);
            return 0;
        }

        if (this.discInfo.noMenuSupport) {
            console.error('_playTitle(): no menu support');
            return 0;
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
            return 1;
        }

        /* top menu ? */
        if (title == BLURAY_TITLE_TOP_MENU) {
            if (!this.discInfo.topMenuSupported) {
                /* no top menu (5.2.3.3) */
                console.error('_play_title(): No top menu title');
                this.titleType = TitleType.HDMV;
                return 1;
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

        return 1;
    }

    private _readReg(reg: number) {
        if (!BlurayRegister.isValidReg(reg)) {
            console.log('_read_reg(): invalid register 0x', numToHex(reg, 4));
            return 0;
        }

        return (reg & PSR_FLAG) ? this.regs.psrRead(reg & 0x7f) : this.regs.gprRead(reg);
    }

    private _readSetstreamRegs(val: number) {
        const flags = (val & 0xf000f000) >>> 0;
        const reg0 = (val & 0xfff) >>> 0;
        const reg1 = ((val >> 16) & 0xfff) >>> 0;

        const val0 = this.regs.gprRead(reg0) & 0x0fff;
        const val1 = this.regs.gprRead(reg1) & 0x0fff;

        return flags | val0 | (val1 << 16);
    }

    private _readSetbuttonpageReg(val: number) {
        const flags = (val & 0xc0000000) >>> 0;
        const reg0  = (val & 0x00000fff) >>> 0;

        const val0  = (this.regs.gprRead(reg0) & 0x3fffffff) >>> 0;

        return flags | val0;
    }

    private _fetchOperand(setstream: number, setbuttonpage: number, imm: number, value: number) {
        if (imm)
            return value;
        if (setstream)
            return this._readSetstreamRegs(value);
        if (setbuttonpage)
            return this._readSetbuttonpageReg(value);

        return this._readReg(value);
    }

    private _storeReg(reg: number, val: number) {
        if (!BlurayRegister.isValidReg(reg)) {
            console.log('_store_reg(): invalid register 0x', numToHex(reg, 4));
            return -1;
        }

        if (reg & PSR_FLAG) {
            console.log('_store_reg(): storing to PSR is not allowed');
            return -1;
        }

        return this.regs.gprWrite(reg, val);
    }

    private _updateHdmvUoMask() {
        const obj = this.object && !this.igObject ? this.object : (this.playingObject ?? this.suspendedObject);
        if (!obj) return 0;
        
        let mask = 0;
        mask |= Number(obj.menuCallMask);
        mask |= Number(obj.titleSearchMask) << 1;

        // const oldMask = this.uoMask;


        return mask;
    }

    private _runHdmv() {
        let maxLoop = MAX_LOOP;

        if (!this.object) {
            console.error('hdmv_vm_run(): no object selected');
            return -1;
        }

        while (--maxLoop > 0) {
            /* suspended ? */
            if (!this.object) {
                console.log('hdmv_vm_run(): object suspended');
                return 0;
            }

            /* terminated ? */
            if (this.pc >= this.object.numCmds) {
                console.log('terminated with PC=', this.pc);
                this.object = null;

                if (this.igObject) {
                    this._queueEventHdmv(HdmvEventE.IG_END, 0, 0);
                    this.igObject = null;
                } else {
                    this._queueEventHdmv(HdmvEventE.END, 0, 0);
                }

                return 0;
            }
            
            const cmd = this.object.cmds[this.pc];
            const insn = cmd.insn;
            let src = 0;
            let dst = 0;
            let incPc = 1;

            const setstream = Number(insn.grp    == HdmvInsnGrp.SET           &&
                                     insn.subGrp == HdmvInsnGrpSet.SETSYSTEM  &&
                                     (    insn.setOpt == HdmvInsnSetsystem.SET_STREAM ||
                                          insn.setOpt == HdmvInsnSetsystem.SET_SEC_STREAM));
            const setbuttonpage = Number(insn.grp    == HdmvInsnGrp.SET           &&
                                         insn.subGrp == HdmvInsnGrpSet.SETSYSTEM  &&
                                         insn.setOpt == HdmvInsnSetsystem.SET_BUTTON_PAGE);

            if (insn.opCnt > 0)
                dst = this._fetchOperand(setstream, setbuttonpage, insn.immOp1, cmd.dst);
            if (insn.opCnt > 1)
                src = this._fetchOperand(setstream, setbuttonpage, insn.immOp2, cmd.src);

            switch (insn.grp) {
                case HdmvInsnGrp.BRANCH:
                    switch (insn.subGrp) {
                        case HdmvInsnGrpBranch.GOTO:
                            if (insn.opCnt > 1)
                                console.error(`too many operands in BRANCH/GOTO opcode 0x${numToHex(hdmvInsnValue(insn), 4)}`);

                            switch (insn.branchOpt) {
                                case HdmvInsnGoto.NOP:                        break;
                                case HdmvInsnGoto.GOTO:  this.pc   = dst - 1; break;
                                case HdmvInsnGoto.BREAK: this.pc   = 1 << 17; break;
                                default:
                                    console.error(`unknown BRANCH/GOTO option ${insn.branchOpt} in opcode 0x${numToHex(hdmvInsnValue(insn), 4)}`);
                                    break;
                            }
                            break;
                        case HdmvInsnGrpBranch.JUMP:
                            if (insn.opCnt > 1)
                                console.error(`too many operands in BRANCH/JUMP opcode 0x${numToHex(hdmvInsnValue(insn), 4)}`);
                                
                            switch (insn.branchOpt) {
                                case HdmvInsnJump.JUMP_TITLE:  this._jumpTitle(dst); break;
                                case HdmvInsnJump.CALL_TITLE:  this._callTitle(dst); break;
                                case HdmvInsnJump.RESUME:      this._resumeObject(1);   break;
                                case HdmvInsnJump.JUMP_OBJECT: if (!this._jumpObject(dst)) { incPc = 0; } break;
                                case HdmvInsnJump.CALL_OBJECT: if (!this._callObject(dst)) { incPc = 0; } break;
                                default:
                                    console.error(`unknown BRANCH/JUMP option ${insn.branchOpt} in opcode 0x${numToHex(hdmvInsnValue(insn), 4)}`);
                                    break;
                            }
                            break;
                        case HdmvInsnGrpBranch.PLAY:
                            switch (insn.branchOpt) {
                                case HdmvInsnPlay.PLAY_PL:      this._playAt(dst,  -1,  -1); break;
                                case HdmvInsnPlay.PLAY_PL_PI:   this._playAt(dst, src,  -1); break;
                                case HdmvInsnPlay.PLAY_PL_PM:   this._playAt(dst,  -1, src); break;
                                case HdmvInsnPlay.LINK_PI:      this._linkAt(     dst,  -1); break;
                                case HdmvInsnPlay.LINK_MK:      this._linkAt(      -1, dst); break;
                                case HdmvInsnPlay.TERMINATE_PL: if (!this._playStop()) { incPc = 0; } break;
                                default:
                                    console.error(`unknown BRANCH/PLAY option ${insn.branchOpt} in opcode 0x${numToHex(hdmvInsnValue(insn), 4)}`);
                                    break;
                            }
                            break;

                        default:
                            console.error(`unknown BRANCH subgroup ${insn.subGrp} in opcode 0x${numToHex(hdmvInsnValue(insn), 4)}`);
                            break;
                    }
                    break; /* INSN_GROUP_BRANCH */

                case HdmvInsnGrp.CMP:
                    if (insn.opCnt < 2)
                        console.error(`missing operands in COMPARE opcode 0x${numToHex(hdmvInsnValue(insn), 4)}`);

                    switch (insn.cmpOpt) {
                        case HdmvInsnCmp.BC: this.pc += Number(!!(dst & ~src)); break;
                        case HdmvInsnCmp.EQ: this.pc += Number( !(dst == src)); break;
                        case HdmvInsnCmp.NE: this.pc += Number( !(dst != src)); break;
                        case HdmvInsnCmp.GE: this.pc += Number( !(dst >= src)); break;
                        case HdmvInsnCmp.GT: this.pc += Number( !(dst >  src)); break;
                        case HdmvInsnCmp.LE: this.pc += Number( !(dst <= src)); break;
                        case HdmvInsnCmp.LT: this.pc += Number( !(dst <  src)); break;
                        default:
                            console.error(`unknown COMPARE option ${insn.cmpOpt} in opcode 0x${numToHex(hdmvInsnValue(insn), 4)}`);
                            break;
                    }
                    break; /* INSN_GROUP_CMP */

                case HdmvInsnGrp.SET:
                    switch (insn.subGrp) {
                        case HdmvInsnGrpSet.SET: {
                            const src0 = src;
                            const dst0 = dst;

                            if (insn.opCnt < 2)
                                console.error(`missing operands in SET/SET opcode 0x${numToHex(hdmvInsnValue(insn), 4)}`);
                                
                            switch (insn.setOpt) {
                                case HdmvInsnSet.MOVE:   dst  = src;         break;
                                case HdmvInsnSet.SWAP:   dst  = src0; src = dst0;    break;
                                case HdmvInsnSet.SUB:    dst  = dst > src ? dst - src :          0; break;
                                case HdmvInsnSet.DIV:    dst  = src > 0   ? dst / src : 0xffffffff; break;
                                case HdmvInsnSet.MOD:    dst  = src > 0   ? dst % src : 0xffffffff; break;
                                case HdmvInsnSet.ADD:    dst += src;         break;
                                case HdmvInsnSet.MUL:    dst *= src;         break;
                                // case HdmvInsnSet.RND:    dst  = RAND_u32(p, src);    break;
                                case HdmvInsnSet.AND:    dst &= src;         break;
                                case HdmvInsnSet.OR:     dst |= src;         break;
                                case HdmvInsnSet.XOR:    dst ^= src;         break;
                                case HdmvInsnSet.BITSET: dst |= ( (1 << src) >>> 0); break;
                                case HdmvInsnSet.BITCLR: dst &= (~(1 << src) >>> 0); break;
                                case HdmvInsnSet.SHL:    dst <<= src;        break;
                                case HdmvInsnSet.SHR:    dst >>= src;        break;
                                default:
                                    console.error(`unknown SET option ${insn.setOpt} in opcode 0x${numToHex(hdmvInsnValue(insn), 4)}`);
                                    break;
                            }

                            /* store result(s) */
                            if (insn.immOp1) {
                                console.error('storing to imm!');
                                break;
                            }

                            if (dst !== dst0)
                                this._storeReg(cmd.dst, dst);
                            if (src !== src0)
                                this._storeReg(cmd.src, src);
                            break;
                        }
                        case HdmvInsnGrpSet.SETSYSTEM:
                            switch (insn.setOpt) {
                                case HdmvInsnSetsystem.SET_STREAM:      this._setStream     (dst, src); break;
                                case HdmvInsnSetsystem.SET_SEC_STREAM:  this._setSecStream  (dst, src); break;
                                // case HdmvInsnSetsystem.SET_NV_TIMER:    this._setNvTimer  (dst, src); break;
                                case HdmvInsnSetsystem.SET_BUTTON_PAGE: this._setButtonPage (dst, src); break;
                                case HdmvInsnSetsystem.ENABLE_BUTTON:   this._enableButton  (dst,   1); break;
                                case HdmvInsnSetsystem.DISABLE_BUTTON:  this._enableButton  (dst,   0); break;
                                case HdmvInsnSetsystem.POPUP_OFF:       this._popupOff      (        ); break;
                                case HdmvInsnSetsystem.STILL_ON:        this._setStillMode  (  1     ); break;
                                case HdmvInsnSetsystem.STILL_OFF:       this._setStillMode  (  0     ); break;
                                case HdmvInsnSetsystem.SET_OUTPUT_MODE: this._setOutputMode (dst     ); break;
                                case HdmvInsnSetsystem.SET_STREAM_SS:   this._setStreamSs   (dst, src); break;
                                case HdmvInsnSetsystem.SETSYSTEM_0x10:  this._setsystem0x10(dst, src); break;
                                default:
                                    console.error(`unknown SETSYSTEM option ${insn.setOpt} in opcode 0x${numToHex(hdmvInsnValue(insn), 4)}`);
                                    break;
                            }
                            break;
                        default:
                            console.error(`unknown SET subgroup ${insn.subGrp} in opcode 0x${numToHex(hdmvInsnValue(insn), 4)}`);
                            break;
                    }
                    break; /* INSN_GROUP_SET */

                default:
                    console.error(`unknown operation group ${insn.grp} in opcode 0x${numToHex(hdmvInsnValue(insn), 4)}`);
                    break;
            }

            /* inc program counter to next instruction */
            this.pc += incPc;
        }

        console.error(`hdmv_vm: infinite program ? terminated after ${MAX_LOOP} instructions.`);
        this.object = null;

        this.hdmvSuspended = !this.object;
        this._updateHdmvUoMask();

        return -1;
    }

    private _readLocked(buf: ArrayBuffer, len: number) {
        console.log(buf, len);
        return 0;
    }

    readExt(buf: ArrayBuffer | null, len: number) {
        if (this.titleType === TitleType.HDMV) {
            let loops = 0;
            while (!this.hdmvSuspended) {
                if (this._runHdmv() < 0) {
                    console.error('bd_read_ext(): HDMV VM error');
                    this.titleType = TitleType.UNDEF;
                    return -1;
                }
                if (loops++ > 100) {
                    /* Detect infinite loops.
                     * Broken disc may cause infinite loop between graphics controller and HDMV VM.
                     * This happens ex. with "Butterfly on a Wheel":
                     * Triggering unmasked "Menu Call" UO in language selection menu skips
                     * menu system initialization code, resulting in infinite loop in root menu.
                     */
                    console.error(`bd_read_ext(): detected possible HDMV mode live lock (${loops} loops)`);
                    this._queueEvent(BdEventE.ERROR, BlurayError.HDMV);
                }
            }

            // gc - graphics controller
        }

        if (len < 1 || !buf)
            return 0;

        if (this.titleType === TitleType.BDJ) {
            console.error('bd_read_ext(): BDJ not supported');
            return -1;
        }

        const bytes = this._readLocked(buf, len);

        if (bytes === 0) {

        }

        return bytes;
    }

    private _parseStream(view: DataView, idx: number) {
        const len = view.getUint8(idx);

        const streamType = view.getUint8(idx + 1);

        const invalidStream = streamType < 1 || streamType > 4;
        if (invalidStream)
            console.error('unrecognized stream type', streamType.toString(16).padStart(2, '0'));

        const subpathId = !invalidStream && streamType > 1 ? view.getUint8(idx + 2) : 0;
        const subclipId = streamType === 2 ? view.getUint8(idx + 3) : 0;
        const pidLoc = [2, 4, 3, 3];
        const pid = !invalidStream ? view.getUint16(idx + pidLoc[streamType - 1]) : 0;

        const infoLen = view.getUint8(idx + len + 1);

        const grp1 = [0x01, 0x02, 0xea, 0x1b, 0x24];
        const grp2 = [0x03, 0x04, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0xa1, 0xa2];
        const grp3 = [0x90, 0x91];

        const codingType = view.getUint8(idx + len + 2);

        const isGrp1 = grp1.includes(codingType);
        const isGrp2 = grp2.includes(codingType);
        const isGrp3 = grp3.includes(codingType);
        const isGrp4 = codingType === 0x92;

        const [format, rate] = isGrp1 || isGrp2 ? readBits(view.getUint8(idx + len + 3), [4, 4]) : [0, 0];
        const lang = isGrp2 || isGrp3 ? binToStr(view.buffer, idx + len + 3 + Number(isGrp2 || isGrp4), 3) : '';
        const charCode = isGrp4 ? view.getUint8(idx + len + 3) : 0;
        
        const [dynamicRangeType, colorSpace, crFlag, hdrPlusFlag] = codingType === 0x24
            ? readBits(view.getUint16(idx + len + 4), [4, 4, 1, 1]) : [0, 0, 0, 0];
            
        const size = len + infoLen + 2;
        const stream: MplsStream = {
            streamType, subpathId, subclipId, pid,
            codingType, format, rate, lang, charCode,
            dynamicRangeType, colorSpace, crFlag, hdrPlusFlag,
            saNumPrimaryAudioRef: 0,
            saPrimaryAudioRef: [],
            svNumSecondaryAudioRef: 0,
            svNumPipPgRef: 0,
            svSecondaryAudioRef: [],
            svPipPgRef: [],
        };

        return { size, stream };
    }

    mplsParse(arrBuf: ArrayBuffer): MplsPl | null {
        const dataView = new DataView(arrBuf);

        const mplsVersion = BlurayPlayer.parseHeader(MPLS_SIG1, dataView);
        if (!mplsVersion)
            return null;

        const listPos = dataView.getUint32(8);
        const markPos = dataView.getUint32(12);
        const extPos = dataView.getUint32(16);

        // const len = dataView.getUint32(40);
        const playbackType = dataView.getUint8(45);
        const playbackCount = playbackType === 2 || playbackType === 3 
            ? dataView.getUint16(46) : 0;
        const uoMask = uoMaskParse(dataView.getBigUint64(48));
        const [
            randomAccessFlag, audioMixFlag, losslessBypassFlag, 
            mvcBaseViewRFlag, sdrConversionNotificationFlag,
        ] = readBits(dataView.getUint8(56), [1, 1, 1, 1, 1, 11])
            .map(bit => Boolean(bit));
        
        const appInfo: MplsAi = {
            playbackType, playbackCount, uoMask,
            randomAccessFlag, audioMixFlag, losslessBypassFlag, 
            mvcBaseViewRFlag, sdrConversionNotificationFlag,
        };

        // const len = dataView.getUint32(listPos);
        const listCount = dataView.getUint16(listPos + 6);
        const subCount = dataView.getUint16(listPos + 8);

        const playItem: MplsPi[] = [];
        let totalLen = listPos + 10;
        for (let i = 0; i < listCount; i++) {
            const len = dataView.getUint16(totalLen);
            const clipId = binToStr(arrBuf, totalLen + 2, 5);
            const codecId = binToStr(arrBuf, totalLen + 7, 4);

            if (codecId !== 'M2TS' && codecId !== 'FMTS')
                console.error('Incorrect CodecIdentifier', codecId);

            const [
                , _isMultiAngle, connectionCondition,
            ] = readBits(dataView.getUint8(totalLen + 12), [3, 1, 4]);
            const isMultiAngle = Boolean(_isMultiAngle);

            if (connectionCondition !== 0x01 && connectionCondition !== 0x05 && connectionCondition !== 0x06)
                console.error('Unexpected connection condition', connectionCondition.toString(16).padStart(2, '0'));

            const stcId = dataView.getUint8(totalLen + 13);
            const inTime = dataView.getUint32(totalLen + 14);
            const outTime = dataView.getUint32(totalLen + 18);

            const uoMask = uoMaskParse(dataView.getBigUint64(totalLen + 22));
            const randomAccessFlag = Boolean(dataView.getUint8(totalLen + 30) & 0x80);
            const stillMode = dataView.getUint8(totalLen + 31);
            const stillTime = stillMode === 0x01 ? dataView.getUint16(totalLen + 32) : 0;

            const angleCount = isMultiAngle ? dataView.getUint8(totalLen + 34) : 1;
            const isDifferentAudio = isMultiAngle && Boolean(dataView.getUint8(totalLen + 35) & 0x02);
            const isSeamlessAngle = isMultiAngle && Boolean(dataView.getUint8(totalLen + 35) & 0x01);

            const clip = [{ clipId, codecId, stcId }];

            for (let ii = 0; ii < angleCount - 1; ii++) {
                const clipId = binToStr(arrBuf, totalLen + 36 + ii * 10, 5);
                const codecId = binToStr(arrBuf, totalLen + 41 + ii * 10, 4);
                const stcId = dataView.getUint8(totalLen + 45 + ii * 10);

                clip.push({ clipId, codecId, stcId });
            }

            let stnIdx = totalLen + 24 + angleCount * 10;
            // Skip STN len
            // const stnLen = dataView.getUint16(stnIdx);
            // Skip 2 reserved bytes
            stnIdx += 4;
            
            const numVideo = dataView.getUint8(stnIdx++);
            const numAudio = dataView.getUint8(stnIdx++);
            const numPg = dataView.getUint8(stnIdx++);
            const numIg = dataView.getUint8(stnIdx++);
            const numSecondaryAudio = dataView.getUint8(stnIdx++);
            const numSecondaryVideo = dataView.getUint8(stnIdx++);
            const numPipPg = dataView.getUint8(stnIdx++);
            const numDv = dataView.getUint8(stnIdx++);

            const video: MplsStream[] = [];
            const audio: MplsStream[] = [];
            const pg: MplsStream[] = [];
            const ig: MplsStream[] = [];
            const secondaryAudio: MplsStream[] = [];
            const secondaryVideo: MplsStream[] = [];
            const dv: MplsStream[] = [];

            // 4 reserve bytes
            stnIdx += 4;

            // Primary Video Streams
            for (let ii = 0; ii < numVideo; ii++) {
                const { size, stream } = this._parseStream(dataView, stnIdx);
                video.push(stream);
                stnIdx += size;
            }

            // Primary Audio Streams
            for (let ii = 0; ii < numAudio; ii++) {
                const { size, stream } = this._parseStream(dataView, stnIdx);
                audio.push(stream);
                stnIdx += size;
            }

            // Presentation Graphic Streams
            for (let ii = 0; ii < numPg; ii++) {
                const { size, stream } = this._parseStream(dataView, stnIdx);
                pg.push(stream);
                stnIdx += size;
            }

            // Interactive Graphic Streams
            for (let ii = 0; ii < numIg; ii++) {
                const { size, stream } = this._parseStream(dataView, stnIdx);
                ig.push(stream);
                stnIdx += size;
            }

            // Secondary Audio Streams
            for (let ii = 0; ii < numSecondaryAudio; ii++) {
                const { size, stream } = this._parseStream(dataView, stnIdx);
                stnIdx += size;

                // Read Secondary Audio Extra Attributes
                stream.saNumPrimaryAudioRef = dataView.getUint8(stnIdx++);
                stnIdx++;

                for (let iii = 0; iii < stream.saNumPrimaryAudioRef; iii++) {
                    stream.saPrimaryAudioRef.push(dataView.getUint8(stnIdx++));

                    if (stream.saNumPrimaryAudioRef % 2)
                        stnIdx++;
                }

                secondaryAudio.push(stream);
            }

            // Secondary Video Streams
            for (let ii = 0; ii < numSecondaryVideo; ii++) {
                const { size, stream } = this._parseStream(dataView, stnIdx);
                stnIdx += size;

                // Read Secondary Video Extra Attributes
                stream.svNumSecondaryAudioRef = dataView.getUint8(stnIdx++);
                stnIdx++;

                for (let iii = 0; iii < stream.svNumSecondaryAudioRef; iii++) {
                    stream.svSecondaryAudioRef.push(dataView.getUint8(stnIdx++));

                    if (stream.svNumSecondaryAudioRef % 2)
                        stnIdx++;
                }

                stream.svNumPipPgRef = dataView.getUint8(stnIdx++);
                stnIdx++;

                for (let iii = 0; iii < stream.svNumPipPgRef; iii++) {
                    stream.svPipPgRef.push(dataView.getUint8(stnIdx++));

                    if (stream.svNumPipPgRef % 2)
                        stnIdx++;
                }

                secondaryVideo.push(stream);
            }

            // Dolby Vision Enhancement Layer Streams
            for (let ii = 0; ii < numDv; ii++) {
                const { size, stream } = this._parseStream(dataView, stnIdx);
                dv.push(stream);
                stnIdx += size;
            }

            const stn: MplsStn = {
                numVideo, numAudio, numPg, numIg, numSecondaryAudio, numSecondaryVideo, numPipPg, numDv,
                video, audio, pg, ig, secondaryAudio, secondaryVideo, dv,
            };

            playItem.push({
                isMultiAngle, connectionCondition, 
                inTime, outTime, uoMask, randomAccessFlag, 
                stillMode, stillTime, 
                angleCount, isDifferentAudio, isSeamlessAngle,
                clip, stn,
            });

            totalLen += len + 2;
        }

        const subPath: MplsSub[] = [];

        for (let i = 0; i < subCount; i++) {
            const len = dataView.getUint32(totalLen);
            const type = dataView.getUint8(totalLen + 5);
            const isRepeat = Boolean(dataView.getUint8(totalLen + 7) & 0x01);
            const subPlayitemCount = dataView.getUint8(totalLen + 9);

            let subPlayIdx = totalLen + 10;
            const subPlayItem: MplsSubPi[] = [];
            for (let ii = 0; ii < subPlayitemCount; ii++) {
                const len = dataView.getUint16(subPlayIdx);
                const clipId = binToStr(arrBuf, subPlayIdx + 2, 5);
                const codecId = binToStr(arrBuf, subPlayIdx + 7, 4);

                if (codecId !== 'M2TS' && codecId !== 'FMTS')
                    console.error('Incorrect CodecIdentifier', codecId);

                const [
                    , connectionCondition, _isMultiClip,
                ] = readBits(dataView.getUint8(subPlayIdx + 14), [3, 4, 1]);
                const isMultiClip = Boolean(_isMultiClip);

                if (connectionCondition !== 0x01 && connectionCondition !== 0x05 && connectionCondition !== 0x06)
                    console.error('Unexpected connection condition', connectionCondition.toString(16).padStart(2, '0'));

                const stcId = dataView.getUint8(subPlayIdx + 15);
                const inTime = dataView.getUint32(subPlayIdx + 16);
                const outTime = dataView.getUint32(subPlayIdx + 20);
                const syncPlayItemId = dataView.getUint16(subPlayIdx + 24);
                const syncPts = dataView.getUint32(subPlayIdx + 26);
                const clipCount = isMultiClip ? dataView.getUint8(subPlayIdx + 30) : 1;

                const clip = [{ clipId, codecId, stcId }];

                for (let ii = 0; ii < clipCount - 1; ii++) {
                    const clipId = binToStr(arrBuf, subPlayIdx + 31 + ii * 10, 5);
                    const codecId = binToStr(arrBuf, subPlayIdx + 36 + ii * 10, 4);
                    const stcId = dataView.getUint8(subPlayIdx + 40 + ii * 10);

                    clip.push({ clipId, codecId, stcId });
                }

                subPlayItem.push({
                    isMultiClip, connectionCondition, inTime, outTime, 
                    syncPlayItemId, syncPts, clipCount, clip,
                });

                subPlayIdx += len;
            }
            
            subPath.push({ type, isRepeat, subPlayitemCount, subPlayItem });

            totalLen += len;
        }

        // const plmLen = dataView.getUint32(markPos);
        const markCount = dataView.getUint16(markPos + 4);
        const playMark: MplsPlm[] = [...Array(markCount).keys()].map(i => ({
            markType: dataView.getUint8(markPos + 7 + i * 14),
            playItemRef: dataView.getUint16(markPos + 8 + i * 14),
            time: dataView.getUint32(markPos + 10 + i * 14),
            entryEsPid: dataView.getUint16(markPos + 14 + i * 14),
            duration: dataView.getUint32(markPos + 16 + i * 14),
        }));

        return {
            typeIndicator: MPLS_SIG1,
            typeIndicator2: mplsVersion,
            listPos, markPos, extPos,
            appInfo,
            listCount, subCount, markCount,
            playItem, subPath, playMark,
            // extSubCount, extSubPath,
            // extPipDataCount, extPipData,
            // extStaticMetadataCount, extStaticMetadata,
        };
    }
    
    async mplsGet(playlist: string) {
        const fp = this.disc['/BDMV/PLAYLIST/' + playlist];
        if (!fp)
            throw new Error(playlist + ' not found.');
        const mplArrBuf = await fp.arrayBuffer();
        const mpls = this.mplsParse(mplArrBuf);
        if (!mpls)
            throw new Error('Could not parse ' + playlist);
        return mpls;
    }
    
    // navTitleOpen(playlist: string, angle: number): NavTitle {
    //     const pl = this.mplsGet(playlist);

    //     return {
    //         name: playlist,
    //         angleCount: 0,
    //         angle: angle,
    //         pl,
    //     }
    // }

    _closePlaylist() {
        // TODO
        throw new Error('Unimplemented _close_playlist()');
    }

    // _openPlaylist(playlist: number, angle: number) {
    //     if (playlist > 99999) {
    //         console.error('Invalid playlist', playlist);
    //         return 0;
    //     }
    //     const fName = playlist.toString().padStart(5, '0') + '.mpls';

    //     if (this.titleList && this.titleType === TitleType.UNDEF) {
    //         console.error(`open_playlist(${playlist}): bd_play() or bd_get_titles() not called`);
    //         return 0;
    //     }

    //     this._closePlaylist();

    //     // this.title = this.navTitleOpen(fName, angle);
    // }

    _processHdmvVmEvent(hev: HdmvEvent) {
        console.log(`HDMV event: ${HdmvEventE[hev.event]}(${hev.event}): ${hev.param1}`);

        // switch (hev.event) {
        //     case HdmvEventE.TITLE:
        //         this._closePlaylist();
        //         this._playTitle(hev.param1);
        //         break;

        //     case HdmvEventE.PLAY_PL:
        //     case HdmvEventE.PLAY_PL_PI:
        //     case HdmvEventE.PLAY_PL_PM:
        //         if (!this._openPlaylist(hev.param1, 0)) {
        //             /* Missing playlist ?
        //             * Seen on some discs while checking UHD capability.
        //             * It seems only error message playlist is present, on success
        //             * non-existing playlist is selected ...
        //             */
        //             bd->hdmv_num_invalid_pl++;
        //             if (bd->hdmv_num_invalid_pl < 10) {
        //                 hdmv_vm_resume(bd->hdmv_vm);
        //                 bd->hdmv_suspended = !hdmv_vm_running(bd->hdmv_vm);
        //                 BD_DEBUG(DBG_BLURAY | DBG_CRIT, "Ignoring non-existing playlist %05d.mpls in HDMV mode\n", hev.param1);
        //                 break;
        //             }
        //         } else {
        //             if (hev.event == HdmvEventE.PLAY_PL_PM) {
        //                 bd_seek_mark(bd, hev.param12);
        //             } else if (hev.event == HdmvEventE.PLAY_PL_PI) {
        //                 bd_seek_playitem(bd, hev.param12);
        //             }
        //             bd->hdmv_num_invalid_pl = 0;
        //         }

        //         /* initialize menus */
        //         _init_ig_stream(bd);
        //         _run_gc(bd, GC_CTRL_INIT_MENU, 0);
        //         break;

        //     case HdmvEventE.PLAY_PI:
        //         bd_seek_playitem(bd, hev.param1);
        //         break;

        //     case HdmvEventE.PLAY_PM:
        //         bd_seek_mark(bd, hev.param1);
        //         break;

        //     case HdmvEventE.PLAY_STOP:
        //         // stop current playlist
        //         this._closePlaylist();

        //         this.hdmvSuspended = !this.object;
        //         break;

        //     case HdmvEventE.STILL:
        //         this._queueEvent(BdEventE.STILL, hev.param1);
        //         break;

        //     // case HdmvEventE.ENABLE_BUTTON:
        //     //     _run_gc(bd, GC_CTRL_ENABLE_BUTTON, hev.param1);
        //     //     break;

        //     // case HdmvEventE.DISABLE_BUTTON:
        //     //     _run_gc(bd, GC_CTRL_DISABLE_BUTTON, hev.param1);
        //     //     break;

        //     // case HdmvEventE.SET_BUTTON_PAGE:
        //     //     _run_gc(bd, GC_CTRL_SET_BUTTON_PAGE, hev.param1);
        //     //     break;

        //     // case HdmvEventE.POPUP_OFF:
        //     //     _run_gc(bd, GC_CTRL_POPUP, 0);
        //     //     break;

        //     // case HdmvEventE.IG_END:
        //     //     _run_gc(bd, GC_CTRL_IG_END, 0);
        //     //     break;

        //     case HdmvEventE.END:
        //     case HdmvEventE.NONE:
        // //default:
        //         break;
        // }
    }

    async play() {
        this.titleType = TitleType.UNDEF;
        this.regs.addEventListener('change', this._processPsrEvent.bind(this));
        this.addEventListener('bd-event', (ev: CustomEventInit<BdEvent>) => {
            if (ev.detail)
                console.log(BdEventE[ev.detail.event], ev.detail.param);
        });
        this._queueInitialPsrEvents();
        await this._playTitle(BLURAY_TITLE_FIRST_PLAY);
        this.readExt(null, 0);
    }
}