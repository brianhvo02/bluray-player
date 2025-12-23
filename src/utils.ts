export const readBits = function(value: number, bits: number[]) {
    return bits.reverse().reduce(([arr, bitLen]: [number[], number], bit) => {
        const mask = [...Array(bit).keys()].reduce((sum, val) => sum + (2 ** (bitLen + val)), 0);
        arr.push((value & mask) >> bitLen);

        return [arr, bitLen + bit] as [number[], number];
    }, [[], 0])[0].reverse();
}

export const strToBin = (str: string) => new DataView(new TextEncoder().encode(str).buffer).getUint32(0);
export const binToStr = (bin: ArrayBufferLike, idx: number, len: number) => new TextDecoder().decode(bin.slice(idx, idx + len));

export const numToHex = (num: number, byteLen: number) => num.toString(16).padStart(byteLen * 2, '0');