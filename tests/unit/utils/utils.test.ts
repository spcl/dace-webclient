// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { getTempColorHslString } from '../../../src/utils/utils';


function testTempColor(): void {
    expect(getTempColorHslString(1.0)).toBe('hsl(0,100%,75%)');
    expect(getTempColorHslString(0.0)).toBe('hsl(120,100%,75%)');
    expect(getTempColorHslString(0.5)).toBe('hsl(60,100%,75%)');
}

describe('Test utility functions', () => {
    test('Badness to temperature color conversion', testTempColor);
});
