export enum MplsSubPathType {
    //        = 2,  /* Primary audio of the Browsable slideshow */
    IG_MENU   = 3,  /* Interactive Graphics presentation menu */
    TEXTST    = 4,  /* Text Subtitle */
    //        = 5,  /* Out-of-mux Synchronous elementary streams */
    ASYNC_PIP = 6,  /* Out-of-mux Asynchronous Picture-in-Picture presentation */
    SYNC_PIP  = 7,  /* In-mux Synchronous Picture-in-Picture presentation */
    SS_VIDEO  = 8,  /* SS Video */
    DV_EL     = 10, /* Dolby Vision Enhancement Layer */
};

export enum MplsPipScaling {
    NONE = 1,       /* unscaled */
    HALF = 2,       /* 1:2 */
    QUARTER = 3,    /* 1:4 */
    ONE_HALF = 4,   /* 3:2 */
    FULLSCREEN = 5, /* scale to main video size */
};

export enum MplsPipTimeLine {
    SYNC_MAINPATH = 1,  /* timeline refers to main path */
    ASYNC_SUBPATH = 2,  /* timeline refers to sub-path time */
    ASYNC_MAINPATH = 3, /* timeline refers to main path */
};

export enum MplsStaticPrimaries {
    PRIMARY_GREEN,
    PRIMARY_BLUE,
    PRIMARY_RED,
}; /* They are stored as GBR, we would like to show them as RGB */