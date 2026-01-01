interface MplsStream {
    streamType            : number;
    codingType            : number;
    pid                   : number;
    subpathId             : number;
    subclipId             : number;
    format                : number;
    rate                  : number;
    dynamicRangeType      : number;
    colorSpace            : number;
    crFlag                : number;
    hdrPlusFlag           : number;
    charCode              : number;
    lang                  : string;
    // Secondary audio specific fields
    saNumPrimaryAudioRef  : number;
    saPrimaryAudioRef     : number[];
    // Secondary video specific fields
    svNumSecondaryAudioRef: number;
    svNumPipPgRef         : number;
    svSecondaryAudioRef   : number[];
    svPipPgRef            : number[];
}

interface MplsStn {
    numVideo         : number;
    numAudio         : number;
    numPg            : number;
    numIg            : number;
    numSecondaryAudio: number;
    numSecondaryVideo: number;
    numPipPg         : number;
    numDv            : number;
    video            : MplsStream[];
    audio            : MplsStream[];
    pg               : MplsStream[];
    ig               : MplsStream[];
    secondaryAudio   : MplsStream[];
    secondaryVideo   : MplsStream[];
    dv               : MplsStream[];
}

interface MplsClip {
    clipId : string;
    codecId: string;
    stcId  : number;
}

interface MplsPi {
    isMultiAngle       : boolean;
    connectionCondition: number;
    inTime             : number;
    outTime            : number;
    uoMask             : UoMask;
    randomAccessFlag   : boolean;
    stillMode          : number;
    stillTime          : number;
    angleCount         : number;
    isDifferentAudio   : boolean;
    isSeamlessAngle    : boolean;
    clip               : MplsClip[];
    stn                : MplsStn;
}

interface MplsPlm {
    markType   : number;
    playItemRef: number;
    time       : number;
    entryEsPid : number;
    duration   : number;
}

interface MplsAi {
    playbackType                 : number;
    playbackCount                : number;
    uoMask                       : UoMask;
    randomAccessFlag             : boolean;
    audioMixFlag                 : boolean;
    losslessBypassFlag           : boolean;
    mvcBaseViewRFlag             : boolean;
    sdrConversionNotificationFlag: boolean;
}

interface MplsSubPi {
    connectionCondition: number;
    isMultiClip        : boolean;
    inTime             : number;
    outTime            : number;
    syncPlayItemId     : number;
    syncPts            : number;
    clipCount          : number;
    clip               : MplsClip[];
}

interface MplsSub {
    type            : number;       /* enum mpls_sub_path_type */
    isRepeat        : boolean;
    subPlayitemCount: number;
    subPlayItem     : MplsSubPi[];
}

interface MplsPipData {
    time       : number;  /* start timestamp (clip time) when the block is valid */
    xpos       : number;
    ypos       : number;
    scaleFactor: number;  /* mpls_pip_scaling. Note: PSR14 may override this ! */
}

interface MplsPipMetadata {
    clipRef          : number;  /* clip id for secondary_video_ref (STN) */
    secondaryVideoRef: number;  /* secondary video stream id (STN) */
    timelineType     : number;  /* mpls_pip_timeline */
    lumaKeyFlag      : boolean; /* use luma keying */
    upperLimitLumaKey: number;  /* luma key (secondary video pixels with Y <= this value are transparent) */
    trickPlayFlag    : boolean; /* show synchronous PiP when playing trick speed */

    dataCount        : number;
    data             : MplsPipData;
}

interface MplsStaticMetadata {
    dynamicRangeType            : number;
    displayPrimariesX           : [number, number, number];
    displayPrimariesY           : [number, number, number];
    whitePointX                 : number;
    whitePointY                 : number;
    maxDisplayMasteringLuminance: number;
    minDisplayMasteringLuminance: number;
    maxCLL                      : number;
    maxFALL                     : number;
}

interface MplsPl {
    typeIndicator         : number;  /* 'MPLS' */
    typeIndicator2        : number;  /* version */
    listPos               : number;
    markPos               : number;
    extPos                : number;
    appInfo               : MplsAi;
    listCount             : number;
    subCount              : number;
    markCount             : number;
    playItem              : MplsPi[];
    subPath               : MplsSub[];
    playMark              : MplsPlm[];

    // // extension data (profile 5, version 2.4)
    // extSubCount           : number;
    // extSubPath            : MplsPipMetadata[];  // sub path entries extension

    // // extension data (Picture-In-Picture metadata)
    // extPipDataCount       : number;
    // extPipData            : MplsPipMetadata[];  // pip metadata extension

    // // extension data (Static Metadata)
    // extStaticMetadataCount: number;
    // extStaticMetadata     : MplsStaticMetadata[];
}