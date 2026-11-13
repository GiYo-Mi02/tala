import { describe, expect, it } from 'vitest';
import { nameFromBoxes } from './boxed-name';
const row={x:0.1,y:0.3,width:0.6,height:0.02};
const token=(text:string,cell:number)=>({text,x:row.x+(cell+0.1)*row.width/20,y:row.y,width:text.length*row.width/20,height:row.height});
describe('P1-06: printed name box spacing',()=>{
  it('joins adjacent one-letter elements without changing raw recognition',()=>{
    const raw='R I V E R A';
    expect(nameFromBoxes([... 'RIVERA'].map((c,i)=>token(c,i)),row,raw)).toBe('RIVERA');
    expect(raw).toBe('R I V E R A');
  });
  it('preserves an intentionally empty name cell',()=>expect(nameFromBoxes([token('DELA',0),token('CRUZ',5)],row,'DELA CRUZ')).toBe('DELA CRUZ'));
  it('preserves two spaces, apostrophes, and hyphens',()=>expect(nameFromBoxes([token("O'NEILL",0),token('SMITH-JONES',9)],row,"O'NEILL SMITH-JONES")).toBe("O'NEILL  SMITH-JONES"));
  it('does not invent a name for an empty field',()=>expect(nameFromBoxes([],row,'')).toBe(''));
});
