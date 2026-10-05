import fs from 'node:fs';import solc from 'solc';import {keccak256} from 'viem';
const data=JSON.parse(fs.readFileSync('research/implementation.json'));const sources={[data.file_path]:{content:data.source_code}};
for(const s of data.additional_sources)sources[s.file_path]={content:s.source_code};
const settings={...data.compiler_settings,outputSelection:{'*':{'*':['evm.deployedBytecode']}}};
const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings})));const errors=output.errors?.filter(e=>e.severity==='error')||[];if(errors.length){console.error(errors);process.exit(1)}
const artifact=output.contracts[data.file_path].CoinbaseSmartWallet.evm.deployedBytecode;
let runtime=artifact.object;const immutableValue='000000000000000000000000000100abaad02f1cfc8bbe32bd5a564817339e72';
for(const ranges of Object.values(artifact.immutableReferences))for(const r of ranges){if(r.length!==32)throw Error('Unexpected immutable size');runtime=runtime.slice(0,r.start*2)+immutableValue+runtime.slice((r.start+r.length)*2)}
const compiled='0x'+runtime;
const result={compiler:solc.version(),immutableAddressApplied:true,exactRuntimeMatch:compiled===data.deployed_bytecode,compiledHash:keccak256(compiled),explorerHash:keccak256(data.deployed_bytecode),source:'https://eth.blockscout.com/api/v2/smart-contracts/0x000100abaad02f1cfC8Bbe32bD5a564817339E72',checkedAt:new Date().toISOString()};
fs.writeFileSync('research/compilation.json',JSON.stringify(result,null,2));console.log(result);if(!result.exactRuntimeMatch)process.exit(1);
