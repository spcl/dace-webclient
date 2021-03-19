// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

export function deepCopy<T>(obj: T): T {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj)) {
        return obj.map(o => deepCopy(o)) as any;
    } else {
        return Object.fromEntries(deepCopy([...Object.entries(obj)])) as any;
    }
}
