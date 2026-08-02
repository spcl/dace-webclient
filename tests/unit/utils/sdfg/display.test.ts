// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { sdfgPropertyToString } from '../../../../src/utils/sdfg/display';
import { SDFVSettings } from '../../../../src/utils/sdfv_settings';


describe('SDFG symbolic expression display', () => {
    afterEach(() => {
        SDFVSettings.set('simplifySymbolicExpressions', true);
    });

    test('removes symbol serialization metadata without simplifying', () => {
        const expression = 'SymExpr(symbol($N, integer=True) + $i * 9f32, ' +
            'Max($N, symbol($M, dtype=dace.uint64)))';

        expect(sdfgPropertyToString(expression, '2.0.0a4')).toBe(
            'SymExpr(N + i * 9f32, Max(N, M))'
        );
    });

    test('preserves quoted contents', () => {
        expect(sdfgPropertyToString(
            'f("$N", symbol($N, integer=True))', '2.0.0a4'
        )).toBe('f("$N", N)');
    });

    test('shows typed serialization when the setting is disabled', () => {
        SDFVSettings.set('simplifySymbolicExpressions', false);
        const expression = 'symbol($N, integer=True) + 1i16';

        expect(sdfgPropertyToString(expression, '2.0.0a4')).toBe(expression);
    });

    test.each(['1.9.9', '2.0.0a3'])(
        'always preserves expressions from DaCe %s', version => {
            SDFVSettings.set('simplifySymbolicExpressions', true);
            const expression = 'symbol($N, integer=True) + $i';

            expect(sdfgPropertyToString(expression, version)).toBe(expression);
        }
    );

    test.each(['2.0.0a4', '2.0.0b1', '2.0.0', '2.1.0'])(
        'simplifies expressions from DaCe %s', version => {
            expect(sdfgPropertyToString('$N + 8.0f64', version)).toBe(
                'N + 8.0f64'
            );
        }
    );
});
