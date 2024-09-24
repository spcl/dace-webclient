// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import { AccessStack, LinkedStack } from '../../../src/utils/collections';

function testLinkedStackConstruction(): void {
    const lStack = new LinkedStack();
    expect(lStack.size).toBe(0);
    expect(lStack.top).toBeUndefined();
    expect(lStack.pop()).toBeUndefined();
}

function testLinkedStackInsertion(): void {
    const lStack = new LinkedStack();

    lStack.push(0);
    lStack.push(1);
    lStack.push(2);
    const rVal = lStack.push(3);

    expect(lStack.size).toBe(4);
    expect(lStack.top?.value).toBe(3);
    expect(rVal).toBe(4);
}

function testLinkedStackPop(): void {
    const lStack = new LinkedStack();

    lStack.push(0);
    lStack.push(1);
    lStack.push(2);
    lStack.push(3);

    const rval = lStack.pop();

    expect(lStack.size).toBe(3);
    expect(lStack.top?.value).toBe(2);
    expect(rval).toBe(3);
}

describe('Test linked stack data structure', () => {
    test('Construction', testLinkedStackConstruction);
    test('Insertion', testLinkedStackInsertion);
    test('Popping', testLinkedStackPop);
});

function testAccessStackConstruction(): void {
    const aStack = new AccessStack();
    expect(aStack.size).toBe(0);
    expect(aStack.top).toBeUndefined();
    expect(aStack.pop()).toBeUndefined();
}

function testAccessStackTouching(): void {
    const aStack = new AccessStack();

    aStack.push(0);
    aStack.push(1);
    aStack.push(2);
    aStack.push(3);
    aStack.push(4);
    aStack.push(5);
    const rval = aStack.pop();

    expect(aStack.size).toBe(5);
    expect(aStack.top?.value).toBe(4);
    expect(rval).toBe(5);

    expect(aStack.touch(0)).toBe(4);
    expect(aStack.touch(0)).toBe(0);
    expect(aStack.top?.value).toBe(0);
    expect(aStack.touch(2)).toBe(3);
    expect(aStack.touch(2)).toBe(0);
    expect(aStack.top?.value).toBe(2);
    expect(aStack.touch(5)).toBe(-1);
    expect(aStack.top?.value).toBe(5);
    expect(aStack.size).toBe(6);
}

describe('Test Access Stack data structure', () => {
    test('Construction', testAccessStackConstruction);
    test('Touching', testAccessStackTouching);
});
