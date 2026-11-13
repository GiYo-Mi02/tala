import { describe, expect, it } from 'vitest';
import fixture from '../../../fixtures/expected/mapping.json';
import { beefTemplate, mapElements, pixelRegion } from './template';
import { fieldKeys } from './fields';
describe('P1-06: source-measured mapping', () => {
  it('maps every learner input and excludes labels and the different guardian', () => {
    const { width, height } = fixture.image;
    const mapped = mapElements(fixture.elements.map(e => ({ text: e.text, x: e.x/width, y: e.y/height, width: e.width/width, height: e.height/height })));
    expect(mapped).toEqual(fixture.expected);
    expect(JSON.stringify(mapped)).not.toMatch(/TORRES|MARCELA|Last Name|Reference/);
  });
  it('keeps all mapped regions within page 1 and none on page 2', () => {
    expect(Object.keys(beefTemplate.regions)).toEqual([...fieldKeys]);
    for (const regions of Object.values(beefTemplate.regions)) for (const r of regions) {
      expect(r.x).toBeGreaterThan(0); expect(r.y).toBeGreaterThan(0);
      expect(r.x+r.width).toBeLessThan(1); expect(r.y+r.height).toBeLessThan(0.5);
    }
  });
  it('scales crop coordinates with the upright accepted image', () => {
    const source = pixelRegion(beefTemplate.regions.learner_last_name[0],1060,1499);
    const double = pixelRegion(beefTemplate.regions.learner_last_name[0],2120,2998);
    expect(source).toEqual({ originX:65,originY:498,width:597,height:29 });
    expect(double).toEqual({ originX:130,originY:996,width:1195,height:59 });
  });
});
