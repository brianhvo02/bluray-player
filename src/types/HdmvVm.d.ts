interface HdmvInsn {
    subGrp      : number;  /* command sub-group */
    opCnt       : number;  /* operand count */
    grp         : number;  /* command group */

    branchOpt   : number;  /* branch option */
    reserved1   : number;
    immOp2      : number;  /* I-flag for operand 2 */
    immOp1      : number;  /* I-flag for operand 1 */

    cmpOpt      : number;  /* compare option */
    reserved2   : number;

    setOpt      : number;  /* set option */
    reserved3   : number;
}

interface MobjCmd {
    insn: HdmvInsn;
    dst: number;
    src: number;
}

interface MobjObject {
    resumeIntentionFlag: boolean;
    menuCallMask: boolean;
    titleSearchMask: boolean;

    numCmds: number;
    cmds: MobjCmd[];
}

interface MobjObjects {
    mobjVersion: number;
    numObjects: number;
    objects: MobjObject[];
}