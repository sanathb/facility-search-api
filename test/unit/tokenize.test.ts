import { describe, expect, it } from 'vitest';
import { tokenize } from '../../src/search/tokenize.js';

describe('tokenize', () => {
  it('lowercases and splits on spaces', () => {
    expect(tokenize('City Fitness Central')).toEqual(['city', 'fitness', 'central']);
  });

  it('strips accents', () => {
    expect(tokenize('Café Zürich')).toEqual(['cafe', 'zurich']);
  });

  it('splits on punctuation and symbols', () => {
    expect(tokenize('24/7 Access')).toEqual(['24', '7', 'access']);
    expect(tokenize('Suburban Strength & Co.')).toEqual(['suburban', 'strength', 'co']);
  });

  it('does not split on capitals inside a word', () => {
    expect(tokenize('FitLife')).toEqual(['fitlife']);
  });

  it('returns no words for empty or punctuation-only input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('  && -- ')).toEqual([]);
  });
});
