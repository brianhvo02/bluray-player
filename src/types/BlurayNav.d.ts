interface NavMark {
    number: number;
    markType: number;
    clipRef: number;
    clipPkt: number;
    clipTime: number;

    // Title relative metrics
    titlePkt: number;
    titleTime: number;
    duration: number;
}

interface NavMarkList {
    count: number;
    mark: NavMark[];
}

interface NavClip {
    name: string;
    clipId: number;
    ref: number;
    startPkt: number;
    endPkt: number;
    connection: number;
    angle: number;

    duration: number;

    inTime: number;
    outTime: number;

    // Title relative metrics
    titlePkt: number;
    titleTime: number;

    title: NavTitle[];

    stcSpn: number;     /* start packet of clip STC sequence */

    cl: ClpiCl[];
}

interface NavClipList {
    count: number;
    clip: NavClip[]
}

interface NavSubPath {
    type: number;
    clipList: NavClipList;
}

interface NavTitle {
    name: string;
    angleCount: number;
    angle: number;
    clipList: NavClipList;
    chapList: NavMarkList;
    markList: NavMarkList;

    subPathCount: number;
    subPath: NavSubPath[];

    packets: number;
    duration: number;

    pl: MplsPl[];
}

interface NavTitleInfo {
    name: string;
    mplsId: number;
    duration: number;
    ref: number;
}

interface NavTitleList {
    count: number;
    titleInfo: NavTitleInfo;
    mainTitleIdx: number;
}