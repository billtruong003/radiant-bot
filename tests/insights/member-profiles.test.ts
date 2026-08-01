import { describe, expect, it } from 'vitest';
import { __for_testing } from '../../src/modules/insights/member-profiles.js';

const { parseProfileJson, capTags, capStr } = __for_testing;

describe('member-profiles parseProfileJson', () => {
  it('parses a clean JSON object', () => {
    const p = parseProfileJson(
      '{"summary":"Hay hỏi về Unity.","interests":["unity","shader"],"tone":"ngắn gọn","expertise":["tech-art"]}',
    );
    expect(p?.summary).toBe('Hay hỏi về Unity.');
    expect(p?.interests).toEqual(['unity', 'shader']);
    expect(p?.expertise).toEqual(['tech-art']);
  });

  it('strips ```json fences', () => {
    const p = parseProfileJson('```json\n{"summary":"Vui vẻ.","interests":[],"tone":"","expertise":[]}\n```');
    expect(p?.summary).toBe('Vui vẻ.');
  });

  it('tolerates prose before the object (models love preambles)', () => {
    const p = parseProfileJson('Đây là kết quả:\n{"summary":"Ít nói.","interests":[],"tone":"","expertise":[]}');
    expect(p?.summary).toBe('Ít nói.');
  });

  it('returns null on unparseable output rather than throwing', () => {
    expect(parseProfileJson('xin lỗi tôi không thể')).toBeNull();
    expect(parseProfileJson('')).toBeNull();
    expect(parseProfileJson('{ broken json')).toBeNull();
  });

  // A profile with no summary is useless and would render as an empty
  // bullet in #bot-log — treat it as a failure so the run counts it.
  it('returns null when summary is missing or empty', () => {
    expect(parseProfileJson('{"interests":["a"]}')).toBeNull();
    expect(parseProfileJson('{"summary":"   "}')).toBeNull();
  });

  it('survives wrong types from the model without throwing', () => {
    const p = parseProfileJson('{"summary":"ok","interests":"không phải mảng","expertise":[1,2],"tone":null}');
    expect(p?.summary).toBe('ok');
    expect(p?.interests).toEqual([]);
    expect(p?.expertise).toEqual([]);
    expect(p?.tone).toBe('');
  });
});

describe('member-profiles field caps', () => {
  it('caps tag count and tag length', () => {
    const tags = capTags(['a'.repeat(100), 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(tags.length).toBeLessThanOrEqual(6);
    expect(tags[0]?.length).toBeLessThanOrEqual(40);
  });

  it('drops empty/whitespace tags', () => {
    expect(capTags(['  ', 'real', ''])).toEqual(['real']);
  });

  it('caps summary length so one chatty model cannot bloat a row', () => {
    expect(capStr('x'.repeat(9999), 400).length).toBe(400);
  });

  it('returns empty string for non-string input', () => {
    expect(capStr(undefined, 100)).toBe('');
    expect(capStr(42, 100)).toBe('');
  });
});
