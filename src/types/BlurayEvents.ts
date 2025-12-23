export enum BdEventE {
    NONE         = 0,  /**< no pending events */

    /*
     * errors
     */

    ERROR        = 1,  /**< Fatal error. Playback can't be continued. */
    READ_ERROR   = 2,  /**< Reading of .m2ts aligned unit failed. Next call to read will try next block. */
    ENCRYPTED    = 3,  /**< .m2ts file is encrypted and can't be played */

    /*
     * current playback position
     */

    ANGLE        = 4,  /**< current angle, 1...N */
    TITLE        = 5,  /**< current title, 1...N (0 = top menu) */
    PLAYLIST     = 6,  /**< current playlist (xxxxx.mpls) */
    PLAYITEM     = 7,  /**< current play item, 0...N-1  */
    CHAPTER      = 8,  /**< current chapter, 1...N */
    PLAYMARK     = 9,  /**< playmark reached */
    END_OF_TITLE = 10, /**< end of title reached */

    /*
     * stream selection
     */

    AUDIO_STREAM           = 11,  /**< 1..32,  0xff  = none */
    IG_STREAM              = 12,  /**< 1..32                */
    PG_TEXTST_STREAM       = 13,  /**< 1..255, 0xfff = none */
    PIP_PG_TEXTST_STREAM   = 14,  /**< 1..255, 0xfff = none */
    SECONDARY_AUDIO_STREAM = 15,  /**< 1..32,  0xff  = none */
    SECONDARY_VIDEO_STREAM = 16,  /**< 1..32,  0xff  = none */

    PG_TEXTST              = 17,  /**< 0 - disable, 1 - enable */
    PIP_PG_TEXTST          = 18,  /**< 0 - disable, 1 - enable */
    SECONDARY_AUDIO        = 19,  /**< 0 - disable, 1 - enable */
    SECONDARY_VIDEO        = 20,  /**< 0 - disable, 1 - enable */
    SECONDARY_VIDEO_SIZE   = 21,  /**< 0 - PIP, 0xf - fullscreen */

    /*
     * playback control
     */

    /** HDMV VM or JVM stopped playlist playback. Flush all buffers. */
    PLAYLIST_STOP          = 22,

    /** discontinuity in the stream (non-seamless connection). Reset demuxer PES buffers. */
    DISCONTINUITY          = 23,  /**< new timestamp (45 kHz) */

    /** HDMV VM or JVM seeked the stream. Next read() will return data from new position. Flush all buffers. */
    SEEK                   = 24,  /**< new media time (45 kHz) */

    /** still playback (pause) */
    STILL                  = 25,  /**< 0 - off, 1 - on */

    /** Still playback for n seconds (reached end of still mode play item).
     *  Playback continues by calling bd_read_skip_still(). */
    STILL_TIME             = 26,  /**< 0 = infinite ; 1...300 = seconds */

    /** Play sound effect */
    SOUND_EFFECT           = 27,  /**< effect ID */

    /*
     * status
     */

    /** Nothing to do. Playlist is not playing, but title applet is running.
     *  Application should not call bd_read*() immediately again to avoid busy loop. */
    IDLE                   = 28,

    /** Pop-Up menu available */
    POPUP                  = 29,  /**< 0 - no, 1 - yes */

    /** Interactive menu visible */
    MENU                   = 30,  /**< 0 - no, 1 - yes */

    /** 3D */
    STEREOSCOPIC_STATUS    = 31,  /**< 0 - 2D, 1 - 3D */

    /** BD-J key interest table changed */
    KEY_INTEREST_TABLE     = 32,  /**< bitmask, BLURAY_KIT_* */

    /** UO mask changed */
    UO_MASK_CHANGED        = 33,  /**< bitmask, BLURAY_UO_* */

    /*LAST = 33, */
}