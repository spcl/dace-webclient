// Copyright 2019-2022 ETH Zurich and the DaCe authors. All rights reserved.

class ListNode<T> {

    constructor(
        public value: T,
        public next?: ListNode<T>,
    ) {
    }

}

export class LinkedStack<T> {

    public top?: ListNode<T>;
    private _size: number = 0;

    public push(value: T): number {
        if (!this.top)
            this.top = new ListNode(value);
        else
            this.top = new ListNode(value, this.top);

        this._size++;

        return this._size;
    }

    public pop(): T | undefined {
        if (this.top) {
            const val = this.top.value;
            this.top = this.top.next;
            this._size--;
            return val;
        }
        return undefined;
    }

    public get size(): number {
        return this._size;
    }

}

export class AccessStack<T> extends LinkedStack<T> {

    public constructor() {
        super();
    }

    /**
     * Move a value to the top if it exists, and return its previous depth.
     * If the value is not in the stack, return -1 and push the value to
     * the stack.
     * @param value 
     */
    public touch(value: T): number {
        let depth = 0;

        let pivot = this.top;
        let previous = undefined;
        let found = false;
        while (pivot) {
            if (pivot.value === value) {
                // Value found.
                // If there is a previous element, splice the stack together
                // while removing the value, and placing it at the top.
                // If there is no previous element, this is the top. In that
                // case, do nothing.
                if (previous) {
                    previous.next = pivot.next;
                    pivot.next = this.top;
                    this.top = pivot;
                }

                found = true;
                break;
            }

            previous = pivot;
            pivot = pivot.next;
            depth++;
        }

        if (!found) {
            this.push(value);
            depth = -1;
        }

        return depth;
    }

    public debugPrint(): void {
        let res = '[';
        let pivot = this.top;
        while (pivot) {
            if (res !== '[')
                res += ' => ';
            res += (pivot.value as any).tag;
            pivot = pivot.next;
        }
        res += ']';
        console.log(res);
    }

}
