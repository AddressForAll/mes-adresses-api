import { parseHouseNumber } from './house-number.util';

describe('parseHouseNumber', () => {
  describe('plain numbers', () => {
    it.each([
      ['123', 123],
      ['0', 0],
      ['99998', 99998],
    ])('parses %s', (raw, numero) => {
      expect(parseHouseNumber(raw)).toEqual({ status: 'ok', numero, suffixe: null });
    });
  });

  describe('numbers with a suffix', () => {
    it.each([
      // raw, numero, suffixe
      ['123A', 123, 'A'],
      ['123 A', 123, 'A'],
      ['5 bis', 5, 'bis'],
      ['5bis', 5, 'bis'],
      ['7 1/2', 7, '1/2'],
      // Real Fresno data: space-separated ranges and halves.
      ['622 624', 622, '624'],
      ['3505 1/2', 3505, '1/2'],
    ])('parses %s', (raw, numero, suffixe) => {
      expect(parseHouseNumber(raw)).toEqual({ status: 'ok', numero, suffixe });
    });

    it('strips the separator from a dashed range', () => {
      // Keeping "-14" would render as "12 --14" once BAL re-applies its dash.
      expect(parseHouseNumber('12-14')).toEqual({
        status: 'ok',
        numero: 12,
        suffixe: '14',
      });
    });

    it.each([
      ['12‐14', 'non-breaking hyphen'],
      ['12–14', 'en dash'],
      ['12—14', 'em dash'],
      ['12−14', 'minus sign'],
      ['12－14', 'fullwidth hyphen'],
    ])('normalises %s (%s)', (raw) => {
      expect(parseHouseNumber(raw)).toEqual({
        status: 'ok',
        numero: 12,
        suffixe: '14',
      });
    });

    it('preserves source casing (importMany owns normalisation)', () => {
      expect(parseHouseNumber('10BIS')).toEqual({
        status: 'ok',
        numero: 10,
        suffixe: 'BIS',
      });
    });
  });

  describe('rejections', () => {
    it.each([
      ['', 'empty'],
      ['   ', 'empty'],
      [null, 'empty'],
      [undefined, 'empty'],
    ])('reports %s as empty', (raw) => {
      expect(parseHouseNumber(raw as never)).toEqual({
        status: 'empty',
      });
    });

    it.each([
      ['s/n', 'Spanish sin número'],
      ['A12', 'leading alpha'],
      ['無番地', 'Japanese block addressing'],
      ['-3', 'negative'],
    ])('reports %s as unparseable (%s)', (raw) => {
      expect(parseHouseNumber(raw)).toEqual({
        status: 'unparseable',
      });
    });

    it('rejects 99999, reserved by BAL for toponyme-only addresses', () => {
      expect(parseHouseNumber('99999')).toEqual({
        status: 'outOfRange',
      });
    });

    it('rejects an absurdly long digit run rather than overflowing', () => {
      expect(parseHouseNumber('12345678901234567890')).toEqual({
        status: 'outOfRange',
      });
    });
  });
});
