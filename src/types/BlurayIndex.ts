import { strToBin } from "../utils.js";

export const BDMV_VERSION_0100 = strToBin('0100');
export const BDMV_VERSION_0200 = strToBin('0200');
export const BDMV_VERSION_0240 = strToBin('0240');
export const BDMV_VERSION_0300 = strToBin('0300');

export const BDMV_VERSIONS = [
    BDMV_VERSION_0100,
    BDMV_VERSION_0200,
    BDMV_VERSION_0240,
    BDMV_VERSION_0300,
];

export const INDX_SIG1 = strToBin('INDX');

export const INDX_ACCESS_PROHIBITED_MASK = 0x01;
export const INDX_ACCESS_HIDDEN_MASK     = 0x02;

export enum TitleType {
    UNDEF = 0,
    HDMV = 1,
    BDJ  = 2,
};

export enum IndxHdmvPlaybackType {
    MOVIE = 0,
    INTERACTIVE = 1,
};

export enum IndxBdjPlaybackType {
    MOVIE = 2,
    INTERACTIVE = 3,
};

export interface IndexObject {
    objectType: TitleType;
    hdmv?: HdmvObject;
    bdj?: BdjObject;
}

export interface TitleObject extends IndexObject {
    accessType: number;
}

export interface HdmvObject {
    playbackType: IndxHdmvPlaybackType;
    idRef: number;
}

export interface BdjObject {
    playbackType: IndxBdjPlaybackType;
    name: string;
}

export interface AppInfo {
    initialOutputModePreference: number;
    contentExistFlag: number;
    initialDynamicRangeType: number;
    videoFormat: number;
    frameRate: number;
    userData: ArrayBufferLike;
}

export interface BlurayIndex { 
    indxVersion: number;
    appInfo: AppInfo;
    firstPlay: IndexObject;
    topMenu: IndexObject;
    titles: TitleObject[];
}

export interface BlurayTitle {
    bdj: boolean;
    idRef: number;
    interactive: boolean;
    accessible: boolean;
    hidden: boolean;
}