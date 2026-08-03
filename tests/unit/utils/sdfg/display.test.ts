// Copyright 2019-2026 ETH Zurich and the DaCe authors. All rights reserved.

import { sdfgPropertyToString } from '../../../../src/utils/sdfg/display';
import { SDFVSettings } from '../../../../src/utils/sdfv_settings';


describe('SDFG symbolic expression display', () => {
    afterEach(() => {
        SDFVSettings.set('simplifySymbolicExpressions', true);
    });

    test('removes symbol serialization metadata without simplifying', () => {
        const expression = 'SymExpr(symbol($N, integer=True) + $i * 9f32, ' +
            'Max($N, symbol($M, dtype=dace.uint64)))';

        expect(sdfgPropertyToString(expression)).toBe(
            'SymExpr(N + i * 9f32, Max(N, M))'
        );
    });

    test('preserves quoted contents', () => {
        expect(sdfgPropertyToString(
            'f("$N", symbol($N, integer=True))'
        )).toBe('f("$N", N)');
    });

    test('shows typed serialization when the setting is disabled', () => {
        SDFVSettings.set('simplifySymbolicExpressions', false);
        const expression = 'symbol($N, integer=True) + 1i16';

        expect(sdfgPropertyToString(expression)).toBe(expression);
    });

    test('leaves legacy symbolic expressions unchanged', () => {
        expect(sdfgPropertyToString('Max(N, M) + i**2')).toBe(
            'Max(N, M) + i**2'
        );
    });
});
