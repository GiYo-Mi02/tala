import { test } from 'node:test';
import assert from 'node:assert/strict';
import { id,putFields,normalizedRect } from '../src/contracts';
import { config } from '../src/config';
import { inspectImage,checksum,PrivateDiskStore } from '../src/storage';

test('strict request contracts preserve leading zeroes and reject unsafe evidence',()=>{
  const raw={ fields:[{key:'lrn',mobileValue:'001234567890',confirmed:true,ocr:null}] };
  assert.equal(putFields.parse(raw).fields[0].mobileValue,'001234567890');
  assert.equal(putFields.safeParse({fields:[{...raw.fields[0],mobileValue:123}]}).success,false);
  assert.equal(normalizedRect.safeParse({x:.9,y:.2,width:.5,height:.2}).success,false);
  assert.equal(id.safeParse('../file').success,false);
});
test('an HTTP listener cannot bind the LAN and production HTTP requires a loopback proxy',()=>{
  const common={DATABASE_URL:'postgresql://unused@localhost/test',STORAGE_ROOT:'./private'};
  assert.throws(()=>config({...common,HOST:'0.0.0.0'}),/HTTPS/);
  assert.throws(()=>config({...common,NODE_ENV:'production'}),/HTTPS/);
  assert.equal(config({...common,NODE_ENV:'production',TRUST_LOOPBACK_PROXY:'true'}).HOST,'127.0.0.1');
});
test('image validation rejects mismatched signatures and filesystem traversal',async()=>{
  const text=Buffer.from('<script>not an image</script>');
  await assert.rejects(inspectImage(text,'image/png',checksum(text)),{code:'INVALID_IMAGE'});
  assert.throws(()=>new PrivateDiskStore('.').read('../private.jpg'),/Invalid internal object key/);
});
