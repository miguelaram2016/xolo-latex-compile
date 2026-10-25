'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {prepareProjectFiles, InvalidProjectError} = require('../project-files');
const good = [{path:'main.tex',content:'hello'}];
test('accepts ordinary source', () => assert.equal(prepareProjectFiles(good).main.path,'main.tex'));
test('rejects traversal, absolute paths and option injection', () => {
  for (const name of ['../secret.tex','dir/../../secret.tex','/etc/passwd','-shell-escape.tex','./main.tex','a//main.tex']) {
    assert.throws(() => prepareProjectFiles([{path:name,content:'x'}]), InvalidProjectError);
  }
});
test('rejects duplicates and invalid encodings',()=>{
 assert.throws(()=>prepareProjectFiles([...good,{path:'MAIN.TEX',content:'x'}]), InvalidProjectError);
 assert.throws(()=>prepareProjectFiles([{path:'main.tex',content:'?',encoding:'base64'}]), InvalidProjectError);
});
test('supports nested and binary project files',()=>{
 const p=prepareProjectFiles([...good,{path:'img/test.png',content:'AAEC/w==',encoding:'base64'}]);
 assert.deepEqual(p.prepared[1].bytes,Buffer.from([0,1,2,255]));
});
test('rejects excessive file counts',()=>assert.throws(()=>prepareProjectFiles(Array(101).fill(good[0])),InvalidProjectError));
