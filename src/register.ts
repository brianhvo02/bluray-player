import { BlurayAcap, BlurayOutput, BlurayPlayerProfile, BlurayRegion, BlurayVcap } from './PlayerSettings';

const bdPsrInit = [
    1,           /*     PSR0:  Interactive graphics stream number */
    0xff,        /*     PSR1:  Primary audio stream number */
    0x0fff0fff,  /*     PSR2:  PG TextST stream number and PiP PG stream number*/
    1,           /*     PSR3:  Angle number */
    0xffff,      /*     PSR4:  Title number */
    0xffff,      /*     PSR5:  Chapter number */
    0,           /*     PSR6:  PlayList ID */
    0,           /*     PSR7:  PlayItem ID */
    0,           /*     PSR8:  Presentation time */
    0,           /*     PSR9:  Navigation timer */
    0xffff,      /*     PSR10: Selected button ID */
    0,           /*     PSR11: Page ID */
    0xff,        /*     PSR12: User style number */
    0xff,        /* PS: PSR13: User age */
    0xffff,      /*     PSR14: Secondary audio stream number and secondary video stream number */
                 /* PS: PSR15: player capability for audio */
    BlurayAcap.LPCM_48_96_SURROUND |
    BlurayAcap.LPCM_192_SURROUND   |
    BlurayAcap.DDPLUS_SURROUND     |
    BlurayAcap.DDPLUS_DEP_SURROUND |
    BlurayAcap.DTSHD_CORE_SURROUND |
    BlurayAcap.DTSHD_EXT_SURROUND  |
    BlurayAcap.DD_SURROUND         |
    BlurayAcap.MLP_SURROUND,

    0xffffff,    /* PS: PSR16: Language code for audio */
    0xffffff,    /* PS: PSR17: Language code for PG and Text subtitles */
    0xffffff,    /* PS: PSR18: Menu description language code */
    0xffff,      /* PS: PSR19: Country code */
                 /* PS: PSR20: Region code */ /* 1 - A, 2 - B, 4 - C */
    BlurayRegion.B,
                 /* PS: PSR21: Output mode preference */
    BlurayOutput.PREFER_2D,
    0,           /*     PSR22: Stereoscopic status */
    0,           /* PS: PSR23: Display capability */
    0,           /* PS: PSR24: 3D capability */
    0,           /* PS: PSR25: UHD capability */
    0,           /* PS: PSR26: UHD display capability */
    0,           /* PS: PSR27: HDR preference */
    0,           /* PS: PSR28: SDR conversion preference */
                 /* PS: PSR29: player capability for video */
    BlurayVcap.SECONDARY_HD |
    BlurayVcap._25Hz_50Hz,

    0x1ffff,     /* PS: PSR30: player capability for text subtitle */
                 /* PS: PSR31: Player profile and version */
    BlurayPlayerProfile._2_v2_0,
    0,           /*     PSR32 */
    0,           /*     PSR33 */
    0,           /*     PSR34 */
    0,           /*     PSR35 */
    0xffff,      /*     PSR36: backup PSR4 */
    0xffff,      /*     PSR37: backup PSR5 */
    0,           /*     PSR38: backup PSR6 */
    0,           /*     PSR39: backup PSR7 */
    0,           /*     PSR40: backup PSR8 */
    0,           /*     PSR41: */
    0xffff,      /*     PSR42: backup PSR10 */
    0,           /*     PSR43: backup PSR11 */
    0xff,        /*     PSR44: backup PSR12 */
    0,           /*     PSR45: */
    0,           /*     PSR46: */
    0,           /*     PSR47: */
    0xffffffff,  /* PS: PSR48: Characteristic text caps */
    0xffffffff,  /* PS: PSR49: Characteristic text caps */
    0xffffffff,  /* PS: PSR50: Characteristic text caps */
    0xffffffff,  /* PS: PSR51: Characteristic text caps */
    0xffffffff,  /* PS: PSR52: Characteristic text caps */
    0xffffffff,  /* PS: PSR53: Characteristic text caps */
    0xffffffff,  /* PS: PSR54: Characteristic text caps */
    0xffffffff,  /* PS: PSR55: Characteristic text caps */
    0xffffffff,  /* PS: PSR56: Characteristic text caps */
    0xffffffff,  /* PS: PSR57: Characteristic text caps */
    0xffffffff,  /* PS: PSR58: Characteristic text caps */
    0xffffffff,  /* PS: PSR59: Characteristic text caps */
    0xffffffff,  /* PS: PSR60: Characteristic text caps */
    0xffffffff,  /* PS: PSR61: Characteristic text caps */
    /* 62-95:   reserved */
    /* 96-111:  reserved for BD system use */
    /* 112-127: reserved */
];

export const bdPsrName = [
    'IG_STREAM_ID',
    'PRIMARY_AUDIO_ID',
    'PG_STREAM',
    'ANGLE_NUMBER',
    'TITLE_NUMBER',
    'CHAPTER',
    'PLAYLIST',
    'PLAYITEM',
    'TIME',
    'NAV_TIMER',
    'SELECTED_BUTTON_ID',
    'MENU_PAGE_ID',
    'STYLE',
    'PARENTAL',
    'SECONDARY_AUDIO_VIDEO',
    'AUDIO_CAP',
    'AUDIO_LANG',
    'PG_AND_SUB_LANG',
    'MENU_LANG',
    'COUNTRY',
    'REGION',
    'OUTPUT_PREFER',
    '3D_STATUS',
    'DISPLAY_CAP',
    '3D_CAP',
    //'PSR_VIDEO_CAP',
];

export const bdRegistersInit = function() {
    return [...bdPsrInit];
}