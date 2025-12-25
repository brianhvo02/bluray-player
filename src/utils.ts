export const readBits = function(_value: number, bits: number[]) {
    const value = BigInt(_value);
    return bits.reverse().reduce(([arr, _bitLen]: [number[], number], bit) => {
        const bitLen = BigInt(_bitLen);

        const mask = [...Array(bit).keys()].reduce((sum, val) => sum + (2n ** (bitLen + BigInt(val))), 0n);
        arr.push(Number((value & mask) >> bitLen));

        return [arr, _bitLen + bit] as [number[], number];
    }, [[], 0])[0].reverse();
}

export const strToBin = (str: string) => new DataView(new TextEncoder().encode(str).buffer).getUint32(0);
export const binToStr = (bin: ArrayBufferLike, idx: number, len: number) => new TextDecoder().decode(bin.slice(idx, idx + len));

export const numToHex = (num: number, byteLen: number) => num.toString(16).padStart(byteLen * 2, '0');