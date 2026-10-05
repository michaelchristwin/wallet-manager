import {decodeEventLog,encodeFunctionData,formatUnits,toHex,type Address,type Hex} from 'viem';
import {createBaseAccountSDK} from '@base-org/account';
import {assertNameUnchanged,type ResolvedAddress} from './ens';
import {walletAbi} from './abi';
import {address,clientFor,same,type Network,type Client} from './chain';
import {assertTrusted,assertSameOwners,inspect,validateNewOwner,type Snapshot} from './wallet';
import {simulateRecovery,type Selection,type Call} from './assets';
export interface Provider{request(args:{method:string;params?:unknown[]|object}):Promise<any>;on?:(event:string,listener:(data:any)=>void)=>void;removeListener?:(event:string,listener:(data:any)=>void)=>void;disconnect?:()=>Promise<void>}
export type Connection={provider:Provider;address:Address;name:string;chainId?:number};
export type ProviderInfo={name:string;uuid:string;provider:Provider};
export type Preview={kind:'addition'|'recovery';snapshot:Snapshot;actor:Address;route:'eoa'|'self'|'contract';data:Hex;calls:Call[];newOwner?:Address;newOwnerContract?:boolean;recipient?:Address;selections?:Selection[];gas?:bigint;gasPrice?:bigint;estimatedFee?:bigint;notes:string[];createdAt:number;resolvedTargets?:ResolvedAddress[]};
export function providersAvailable(callback:(p:ProviderInfo)=>void){
 const listener=(e:Event)=>{const d=(e as CustomEvent).detail;if(d?.provider?.request&&d.info?.uuid)callback({name:d.info.name,uuid:d.info.uuid,provider:d.provider});};window.addEventListener('eip6963:announceProvider',listener);window.dispatchEvent(new Event('eip6963:requestProvider'));
 const ethereum=(window as any).ethereum;if(ethereum?.request)callback({name:'Browser wallet',uuid:'injected',provider:ethereum});
 return ()=>window.removeEventListener('eip6963:announceProvider',listener);
}
let accountProvider:Provider|undefined;
export function coinbaseProvider():Provider{return accountProvider??=createBaseAccountSDK({appName:'Wallet Reserve',appLogoUrl:new URL('/favicon.svg',location.origin).href,appChainIds:[1,8453,10,42161,137,56,43114,7777777,33139,143],preference:{telemetry:false},subAccounts:{creation:'manual',defaultAccount:'universal'}}).getProvider() as unknown as Provider;}
export async function connect(provider:Provider,name:string):Promise<Connection>{const accounts=await provider.request({method:'eth_requestAccounts'});if(!accounts?.[0])throw Error('No account was returned by the wallet.');const chainId=Number(await provider.request({method:'eth_chainId'}));return {provider,address:address(accounts[0]),name,chainId};}
export function watchConnection(connection:Connection,onAccount:(account:Address|null)=>void,onChain:(chainId:number)=>void,onDisconnect:()=>void){
 const accounts=(values:unknown)=>{if(!Array.isArray(values)||!values.length){onAccount(null);return;}try{const next=address(values[0]);if(!same(next,connection.address))onAccount(next);}catch{onAccount(null)}};
 const chain=(value:unknown)=>{const next=Number(value);if(Number.isSafeInteger(next)&&next>0&&next!==connection.chainId)onChain(next);};
 connection.provider.on?.('accountsChanged',accounts);connection.provider.on?.('chainChanged',chain);connection.provider.on?.('disconnect',onDisconnect);
 return ()=>{connection.provider.removeListener?.('accountsChanged',accounts);connection.provider.removeListener?.('chainChanged',chain);connection.provider.removeListener?.('disconnect',onDisconnect)};
}
export async function switchNetwork(connection:Connection,n:Network){
 const current=Number(await connection.provider.request({method:'eth_chainId'}));if(current===n.chain.id)return;
 try{await connection.provider.request({method:'wallet_switchEthereumChain',params:[{chainId:toHex(n.chain.id)}]});}
 catch(e){if((e as any).code!==4902)throw e;await connection.provider.request({method:'wallet_addEthereumChain',params:[{chainId:toHex(n.chain.id),chainName:n.chain.name,nativeCurrency:n.chain.nativeCurrency,rpcUrls:[n.rpc],blockExplorerUrls:[n.chain.blockExplorers!.default.url]}]});await connection.provider.request({method:'wallet_switchEthereumChain',params:[{chainId:toHex(n.chain.id)}]});}
 if(Number(await connection.provider.request({method:'eth_chainId'}))!==n.chain.id)throw Error('Wallet did not switch to the selected chain.');
}
export function actorRoute(s:Snapshot,actor:Address):Preview['route']{if(same(actor,s.wallet))return 'self';const o=s.owners.find(o=>o.address&&same(o.address,actor));if(!o)throw Error('The authorizing address is not a registered owner.');return o.isContract?'contract':'eoa';}
async function gasPreview(c:Client,s:Snapshot,actor:Address,data:Hex,route:Preview['route']){
 if(route==='contract')return {notes:['The connected contract owner authorizes this call through its wallet provider. Its wallet determines the final fee; Safe exports are also available.']};
 if(route==='self')return {notes:['The connected smart wallet submits a chain-specific wallet call. Its wallet/bundler determines the final fee. Keep gas funds in the account and EntryPoint.']};
 const gas=await c.estimateGas({account:actor,to:s.wallet,data});const gasPrice=await c.getGasPrice();const estimatedFee=gas*gasPrice;
 return {gas,gasPrice,estimatedFee,notes:[route==='eoa'?'The connected EOA pays gas from its own native balance.':'The multisig execution pays gas through its own transaction flow.','The fee estimate excludes any additional L1 data fee on rollups. Your signing wallet shows the final fee.']};
}
export async function previewAddition(n:Network,rpc:string|undefined,s:Snapshot,actor:Address,newOwner:Address):Promise<Preview>{
 assertTrusted(s);const fresh=await inspect(n,s.wallet,rpc);assertSameOwners(s,fresh);const c=clientFor(n,rpc);const {isContract}=await validateNewOwner(c,fresh,newOwner);const route=actorRoute(fresh,actor);
 const data=encodeFunctionData({abi:walletAbi,functionName:'addOwnerAddress',args:[newOwner]});await c.call({account:actor,to:s.wallet,data});
 const fee=await gasPreview(c,fresh,actor,data,route);return {kind:'addition',snapshot:fresh,actor,route,data,calls:[],newOwner,newOwnerContract:isContract,...fee,createdAt:Date.now(),notes:[...fee.notes,isContract?'New owner has contract code. Confirm the multisig can execute calls from this exact address on this chain.':'New owner has no contract code (or is a delegated EOA). Confirm that you control its private key.','This adds one full-control owner. Existing indexes are preserved; no removal, upgrade, or cross-chain replay call is included.']};
}
export async function previewRecovery(n:Network,rpc:string|undefined,s:Snapshot,actor:Address,recipient:Address,selections:Selection[]):Promise<Preview>{
 assertTrusted(s);const fresh=await inspect(n,s.wallet,rpc);assertSameOwners(s,fresh);const c=clientFor(n,rpc);const route=actorRoute(fresh,actor);
 const updated=selections.map(x=>({...x,asset:{...x.asset,balance:x.asset.kind==='native'?fresh.native:x.asset.kind==='deposit'?(fresh.deposit??0n):x.asset.balance}}));
 if(route==='self')for(const {asset,amount} of updated){if((asset.kind==='native'||asset.kind==='deposit')&&amount>=asset.balance)throw Error('For recovery through the smart wallet itself, leave native currency and EntryPoint gas reserves. Use a registered external EOA to withdraw the full balance.');}
 const simulated=await simulateRecovery(c,fresh,actor,recipient,updated);const fee=await gasPreview(c,fresh,actor,simulated.data,route);const recipientCode=await c.getCode({address:recipient});return {kind:'recovery',snapshot:fresh,actor,route,data:simulated.data,calls:simulated.calls,selections:updated,recipient,...fee,notes:[...fee.notes,...simulated.notes,...(recipientCode&&recipientCode!=='0x'?['Recipient has contract code. Make sure it supports holding and recovering these assets.']:[])],createdAt:Date.now()};
}
export async function recheckPreview(n:Network,rpc:string|undefined,p:Preview){
 if(Date.now()-p.createdAt>5*60*1000)throw Error('This preview is more than five minutes old. Close it and review a fresh transaction.');
 for(const target of p.resolvedTargets??[])await assertNameUnchanged(target);
 const fresh=await inspect(n,p.snapshot.wallet,rpc);assertTrusted(fresh);assertSameOwners(p.snapshot,fresh);actorRoute(fresh,p.actor);const c=clientFor(n,rpc);
 if(p.kind==='addition'){const status=await validateNewOwner(c,fresh,p.newOwner!);if(status.isContract!==p.newOwnerContract)throw Error('New owner code changed since the preview. Review again.');await c.call({account:p.actor,to:fresh.wallet,data:p.data});}
 else {if(p.route==='self')for(const x of p.selections!){const b=x.asset.kind==='native'?fresh.native:x.asset.kind==='deposit'?fresh.deposit:null;if(b!==null&&x.amount>=b)throw Error('Gas reserves changed. Refresh and review the withdrawal again.');}const r=await simulateRecovery(c,fresh,p.actor,p.recipient!,p.selections!);if(r.data!==p.data)throw Error('Transaction data changed. Review again.');}
 return {fresh,c};
}
export async function submit(connection:Connection,n:Network,rpc:string|undefined,p:Preview,onStatus:(s:string)=>void,onBroadcast:(id:string,mode:'transaction'|'calls')=>void):Promise<Hex>{
 const accounts=await connection.provider.request({method:'eth_accounts'});if(!accounts?.[0]||!same(accounts[0],p.actor))throw Error('Connect the exact authorizing account shown in the preview.');
 if(Number(await connection.provider.request({method:'eth_chainId'}))!==n.chain.id)throw Error('The connected wallet is on a different chain. Switch networks and review again.');
 const checkSigner=async()=>{for(const target of p.resolvedTargets??[])await assertNameUnchanged(target);const latest=await connection.provider.request({method:'eth_accounts'});if(!latest?.[0]||!same(latest[0],p.actor)||Number(await connection.provider.request({method:'eth_chainId'}))!==n.chain.id)throw Error('Connected account or chain changed. Review again.');};
 const {c}=await recheckPreview(n,rpc,p);onStatus('Waiting for your wallet signature…');
 if(p.route==='eoa'){
  const code=await c.getCode({address:p.actor});if(code&&code!=='0x'&&!code.startsWith('0xef0100'))throw Error('The signing account now has contract code. Use a multisig export.');
  const gas=await c.estimateGas({account:p.actor,to:p.snapshot.wallet,data:p.data});const gasLimit=gas*120n/100n;const gasPrice=await c.getGasPrice();if(await c.getBalance({address:p.actor})<gasLimit*gasPrice)throw Error(`The owner needs more ${n.chain.nativeCurrency.symbol} to pay gas. Fund the EOA; this transaction does not use the smart wallet deposit.`);
  await checkSigner();
  const hash=await connection.provider.request({method:'eth_sendTransaction',params:[{from:p.actor,to:p.snapshot.wallet,data:p.data,value:'0x0',gas:toHex(gasLimit),chainId:toHex(n.chain.id)}]}) as Hex;
  if(typeof hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error('Wallet did not return a transaction hash. Check its activity before retrying.');
  onBroadcast(hash,'transaction');onStatus('Submitted. Waiting for chain confirmation…');const receipt=await c.waitForTransactionReceipt({hash,confirmations:2,timeout:180000});if(receipt.status!=='success')throw Error('Transaction reverted. No batch calls or owner addition took effect. Gas may still have been spent.');return hash;
 }
 await checkSigner();
 // One transaction contains the reviewed wallet batch. Standard eth_sendTransaction
 // works with both smart-account SDKs and injected providers without assuming EIP-5792.
 const hash=await connection.provider.request({method:'eth_sendTransaction',params:[{from:p.actor,to:p.snapshot.wallet,data:p.data,value:'0x0',chainId:toHex(n.chain.id)}]});
 if(typeof hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error('Wallet did not return a transaction hash. Check its activity before retrying.');
 onBroadcast(hash,'transaction');onStatus('Submitted through your smart wallet. Waiting for confirmation…');
 const receipt=await c.waitForTransactionReceipt({hash:hash as Hex,confirmations:2,timeout:180000});assertExecutionReceipt(receipt,p.actor,p.snapshot.entryPoint);return hash as Hex;
}
const userOperationEvent=[{type:'event',name:'UserOperationEvent',inputs:[{name:'userOpHash',type:'bytes32',indexed:true},{name:'sender',type:'address',indexed:true},{name:'paymaster',type:'address',indexed:true},{name:'nonce',type:'uint256',indexed:false},{name:'success',type:'bool',indexed:false},{name:'actualGasCost',type:'uint256',indexed:false},{name:'actualGasUsed',type:'uint256',indexed:false}]}] as const;
export function assertExecutionReceipt(receipt:{status:string;logs?:readonly any[]},actor:Address,entryPoint:Address){
 if(receipt.status!=='success')throw Error('Smart wallet transaction reverted.');
 for(const log of receipt.logs??[]){if(!same(log.address,entryPoint))continue;let decoded;try{decoded=decodeEventLog({abi:userOperationEvent,data:log.data,topics:log.topics})}catch{continue;}if(same(decoded.args.sender,actor)&&!decoded.args.success)throw Error('The bundler transaction was mined, but this smart account operation failed. Gas may have been spent. Check wallet activity before retrying.');}
}

export function safeExport(p:Preview){return {version:'1.0',chainId:String(p.snapshot.chainId),createdAt:Date.now(),meta:{name:p.kind==='addition'?'Add Coinbase wallet backup owner':'Recover Coinbase wallet assets',description:'Reviewed chain-specific contract call. Re-simulate in Safe before signing; this export may become stale.',txBuilderVersion:'1.18.0',createdFromSafeAddress:p.actor,createdFromOwnerAddress:''},transactions:[{to:p.snapshot.wallet,value:'0',data:p.data,contractMethod:null,contractInputsValues:null}]};}
export function feeLabel(p:Preview,n:Network){return p.estimatedFee?`${formatUnits(p.estimatedFee,18).slice(0,13)} ${n.chain.nativeCurrency.symbol} + any rollup data fee`:'Final fee shown by your smart wallet';}
