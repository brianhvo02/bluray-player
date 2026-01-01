import { strToBin } from './utils.js';

export const INDX_SIG1 = strToBin('INDX');
export const MOBJ_SIG1 = strToBin('MOBJ');
export const MPLS_SIG1 = strToBin('MPLS');

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

export const INDX_ACCESS_PROHIBITED_MASK = 0x01;
export const INDX_ACCESS_HIDDEN_MASK     = 0x02;            

export enum BlurayError {
    /* BD_EVENT_ERROR param values */
    HDMV   = 1,     /**< HDMV VM failed to play the title  */
    BDJ    = 2,     /**< BD-J failed to play the title     */

    /* BD_EVENT_ENCRYPTED param values */
    AACS   = 3,     /**< AACS failed or not supported      */
    BDPLUS = 4,     /**< BD+ failed or not supported       */
}

/* BD_EVENT_TITLE special titles */
export const BLURAY_TITLE_FIRST_PLAY  = 0xffff;   /**< "First Play" title started        */
export const BLURAY_TITLE_TOP_MENU    = 0;        /**< "Top Menu" title started          */

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

export const MAX_LOOP = 1000000;