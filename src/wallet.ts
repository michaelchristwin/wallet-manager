import {getAddress,keccak256,decodeAbiParameters,encodeAbiParameters,zeroAddress,type Address,type Hex} from 'viem';
import {walletAbi,entryAbi} from './abi';
import {clientFor,IMPLEMENTATION_SLOT,same,type Client,type Network} from './chain';
import trusted from './trusted-code.json';
export type Owner={index:number;bytes:Hex;kind:'address'|'passkey'|'unknown';address?:Address;isContract?:boolean};
export type Snapshot={wallet:Address;chainId:number;block:bigint;implementation:Address;implementationHash:Hex;proxyHash:Hex;verified:boolean;nextIndex:bigint;count:bigint;owners:Owner[];native:bigint;entryPoint:Address;entryPointHash?:Hex;deposit:bigint|null;stake:bigint|null;depositError?:string;checkedAt:number};
export function decodeOwner(index:number,bytes:Hex):Owner{
 if(bytes.length===66&&/^0x0{24}/i.test(bytes)){return {index,bytes,kind:'address',address:decodeAbiParameters([{type:'address'}],bytes)[0]};}
 if(bytes.length===130)return {index,bytes,kind:'passkey'};
 return {index,bytes,kind:'unknown'};
}
export async function inspect(network:Network,wallet:Address,rpc?:string):Promise<Snapshot>{
 const c=clientFor(network,rpc);if(await c.getChainId()!==network.chain.id)throw Error('RPC chain ID does not match the selected network.');
 const block=await c.getBlockNumber();const code=await c.getCode({address:wallet,blockNumber:block});if(!code||code==='0x')throw Error('No smart wallet is deployed at this address on this chain.');
 const storage=await c.getStorageAt({address:wallet,slot:IMPLEMENTATION_SLOT,blockNumber:block});if(!storage||BigInt(storage)===0n)throw Error('This is not a supported ERC-1967 Coinbase wallet proxy.');
 const implementation=getAddress('0x'+storage.slice(-40));const implCode=await c.getCode({address:implementation,blockNumber:block});if(!implCode||implCode==='0x')throw Error('The proxy implementation has no code.');
 const read=(fn:'nextOwnerIndex'|'ownerCount'|'implementation'|'entryPoint')=>c.readContract({address:wallet,abi:walletAbi,functionName:fn,blockNumber:block});
 const [nextIndex,count,reported,entryPoint,native]=await Promise.all([read('nextOwnerIndex'),read('ownerCount'),read('implementation'),read('entryPoint'),c.getBalance({address:wallet,blockNumber:block})]) as [bigint,bigint,Address,Address,bigint];
 if(!same(reported,implementation))throw Error('Implementation storage and contract getter disagree.');
 if(nextIndex>1024n)throw Error('More than 1,024 historical owner indexes. Inspection stopped rather than showing an incomplete owner list.');
 const owners:Owner[]=[];
 for(let start=0;start<Number(nextIndex);start+=12){const batch=await Promise.all(Array.from({length:Math.min(12,Number(nextIndex)-start)},async(_,j)=>{
  const index=start+j;const bytes=await c.readContract({address:wallet,abi:walletAbi,functionName:'ownerAtIndex',args:[BigInt(index)],blockNumber:block});
  if(bytes==='0x')return null;
  const owner=decodeOwner(index,bytes);if(owner.address){const code=await c.getCode({address:owner.address,blockNumber:block});owner.isContract=!!code&&code!=='0x'&&!code.startsWith('0xef0100');}return owner;
 }));owners.push(...batch.filter((o):o is Owner=>o!==null));}
 if(BigInt(owners.length)!==count)throw Error('Owner count does not match the enumerated indexes.');
 const proxyHash=keccak256(code);const implementationHash=keccak256(implCode);
 const verified=proxyHash===trusted.proxyHash&&implementationHash===trusted.implementationHash&&owners.every(o=>o.kind!=='unknown')&&count>0n;
 const epCode=await c.getCode({address:entryPoint,blockNumber:block});const entryPointHash=epCode&&epCode!=='0x'?keccak256(epCode):undefined;
 let deposit:bigint|null=null,stake:bigint|null=null,depositError:string|undefined;
 if(entryPointHash===trusted.entryPointHash&&same(entryPoint,trusted.entryPoint)){
  try{const info=await c.readContract({address:entryPoint,abi:entryAbi,functionName:'getDepositInfo',args:[wallet],blockNumber:block});deposit=info.deposit;stake=info.stake;}catch{depositError='EntryPoint deposit lookup failed. Deposit recovery is disabled.';}
 }else depositError='EntryPoint is absent or its bytecode is unrecognized. Deposit recovery is disabled.';
 return {wallet,chainId:network.chain.id,block,implementation,implementationHash,proxyHash,verified,nextIndex,count,owners,native,entryPoint,entryPointHash,deposit,stake,depositError,checkedAt:Date.now()};
}
export function assertTrusted(s:Snapshot){if(!s.verified)throw Error('Transactions are disabled: the proxy or implementation does not match the reviewed bytecode.');}
export function assertSameOwners(before:Snapshot,after:Snapshot){
 if(before.chainId!==after.chainId||!same(before.wallet,after.wallet))throw Error('Wallet or chain changed. Inspect again.');
 if(before.implementationHash!==after.implementationHash||!same(before.implementation,after.implementation)||before.proxyHash!==after.proxyHash)throw Error('Implementation changed. Review the wallet again.');
 if(before.nextIndex!==after.nextIndex||before.count!==after.count||before.owners.length!==after.owners.length||before.owners.some(o=>after.owners.find(x=>x.index===o.index)?.bytes!==o.bytes))throw Error('Owner configuration changed since the preview. Inspect and review again.');
}
export function assertAddition(before:Snapshot,after:Snapshot,newOwner:Address){
 if(before.chainId!==after.chainId||!same(before.wallet,after.wallet)||before.implementationHash!==after.implementationHash||!same(before.implementation,after.implementation))throw Error('Wallet implementation changed during confirmation.');
 if(after.nextIndex!==before.nextIndex+1n||after.count!==before.count+1n)throw Error('Owner count or index differs from the expected addition. Review the on-chain state.');
 for(const o of before.owners)if(after.owners.find(x=>x.index===o.index)?.bytes!==o.bytes)throw Error('An existing owner changed. Review the on-chain state immediately.');
 const expected=encodeAbiParameters([{type:'address'}],[newOwner]);if(after.owners.find(o=>o.index===Number(before.nextIndex))?.bytes.toLowerCase()!==expected.toLowerCase())throw Error('The added owner does not match the requested address.');
}
export async function validateNewOwner(c:Client,s:Snapshot,newOwner:Address){
 assertTrusted(s);if([zeroAddress,s.wallet,s.implementation,s.entryPoint].some(a=>same(a,newOwner)))throw Error('Use an independent, nonzero EOA or multisig address.');
 if(s.owners.some(o=>o.address&&same(o.address,newOwner)))throw Error('That address is already an owner.');
 const code=await c.getCode({address:newOwner});return {isContract:!!code&&code!=='0x'&&!code.startsWith('0xef0100')};
}
