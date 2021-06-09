/**
 * Adapted from:
 * Lodash <https://lodash.com/>
 * Copyright OpenJS Foundation and other contributors <https://openjsf.org/>
 * Released under MIT license <https://lodash.com/license>
 * Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>
 * Copyright Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
 */

export default class Shuffle {
    public static shuffle(array: Array<any>): Array<any> {
        const baseRandom = (lower, upper) => {
            return lower + Math.floor(Math.random() * (upper - lower + 1));
        }
        let index = -1;
        const length = array.length;
        const lastIndex = length - 1;
        while (++index < length) {
            const rand = baseRandom(index, lastIndex);
            const value = array[rand];
            array[rand] = array[index];
            array[index] = value;
        }
        return array;
    }
}
