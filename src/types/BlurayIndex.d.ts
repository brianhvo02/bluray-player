interface IndexObject {
    objectType: TitleType;
    hdmv?: HdmvObject;
    bdj?: BdjObject;
}

interface TitleObject extends IndexObject {
    accessType: number;
}

interface HdmvObject {
    playbackType: IndxHdmvPlaybackType;
    idRef: number;
}

interface BdjObject {
    playbackType: IndxBdjPlaybackType;
    name: string;
}

interface AppInfo {
    initialOutputModePreference: number;
    contentExistFlag: number;
    initialDynamicRangeType: number;
    videoFormat: number;
    frameRate: number;
    userData: ArrayBufferLike;
}

interface BlurayIndex { 
    indxVersion: number;
    appInfo: AppInfo;
    firstPlay: IndexObject;
    topMenu: IndexObject;
    titles: TitleObject[];
}

interface BlurayTitle {
    bdj: boolean;
    idRef: number;
    interactive: boolean;
    accessible: boolean;
    hidden: boolean;
}