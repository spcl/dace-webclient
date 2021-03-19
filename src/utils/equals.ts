// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

export function equals<T>(a: T, b: T): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}
