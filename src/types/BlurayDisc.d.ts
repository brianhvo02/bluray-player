type FileMap = Record<string, File>;

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
    providerData: ArrayBufferLike;           /**< Content provider data */

    /* AACS info  (valid only if disc uses AACS) */
    aacsDetected?: number;     /**< 1 if disc is using AACS encoding */
    libaacsDetected?: number;  /**< 1 if usable AACS decoding library was found */
    aacsHandled?: number;      /**< 1 if disc is using supported AACS encoding */

    aacsErrorCode?: number;   /**< AACS error code (BD_AACS_*) */
    aacsMkbv?: number;        /**< AACS MKB version */

    /* BD+ info  (valid only if disc uses BD+) */
    bdplusDetected?: boolean;     /**< 1 if disc is using BD+ encoding */
    libbdplusDetected?: boolean;  /**< 1 if usable BD+ decoding library was found */
    bdplusHandled?: boolean;      /**< 1 if disc is using supporred BD+ encoding */

    bdplusGen?: number;          /**< BD+ content code generation */
    bdplusDate?: number;         /**< BD+ content code relese date ((year<<16)|(month<<8)|day) */

    /* disc application info (libbluray > 1.2.0) */
    initialDynamicRangeType: number; /**< bd_dynamic_range_type_e */
}