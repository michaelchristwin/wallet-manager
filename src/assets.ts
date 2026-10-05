import {parseUnits,formatUnits,encodeFunctionData,pad,toHex,keccak256,toBytes,decodeEventLog,type Address,type Hex} from 'viem';
import {tokenAbi,entryAbi,walletAbi} from './abi';
import {address,same,errorText,type Client,type Network} from './chain';
import {assertTrusted,type Snapshot} from './wallet';
export type AssetKind='native'|'deposit'|'erc20'|'erc721'|'erc1155';
export type Asset={key:string;kind:AssetKind;contract?:Address;tokenId?:bigint;symbol:string;name:string;decimals:number;balance:bigint;source:string;warning?:string};
export type Call={target:Address;value:bigint;data:Hex};
export type Selection={asset:Asset;amount:bigint};
export const assetKey=(kind:AssetKind,contract?:Address,id?:bigint)=>`${kind}:${contract?.toLowerCase()||''}:${id===undefined?'':id.toString()}`;
export function baseAssets(s:Snapshot,n:Network):Asset[]{return [{key:'native',kind:'native',symbol:n.chain.nativeCurrency.symbol,name:'Wallet balance',decimals:18,balance:s.native,source:'On-chain'},...(s.deposit!==null?[{key:'deposit',kind:'deposit' as const,symbol:n.chain.nativeCurrency.symbol,name:'EntryPoint gas deposit',decimals:18,balance:s.deposit,source:'On-chain'}]:[])];}
export function displayBalance(a:Asset){const f=formatUnits(a.balance,a.decimals);const [whole,dec]=f.split('.');return dec?`${whole}.${dec.slice(0,8).replace(/0+$/,'')||'0'}`:whole;}
export function amountFor(a:Asset,text:string){
 if(!/^\d+(\.\d+)?$/.test(text))throw Error(`Enter a positive amount for ${a.symbol}.`);
 if((text.split('.')[1]?.length||0)>a.decimals)throw Error(`${a.symbol} supports ${a.decimals} decimal places.`);
 const amount=parseUnits(text,a.decimals);if(amount<=0n||amount>a.balance)throw Error(`Amount exceeds the available ${a.symbol} balance, or is zero.`);
 if(a.kind==='erc721'&&amount!==1n)throw Error('An ERC-721 selection must transfer exactly one NFT.');return amount;
}
export async function holding(c:Client,wallet:Address,a:Asset,block?:bigint):Promise<bigint>{
 if(a.kind==='native')return c.getBalance({address:wallet,blockNumber:block});
 if(a.kind==='deposit')throw Error('Read deposit through the wallet inspection.');
 if(a.kind==='erc721'){const owner=await c.readContract({address:a.contract!,abi:tokenAbi,functionName:'ownerOf',args:[a.tokenId!],blockNumber:block});return same(owner,wallet)?1n:0n;}
 if(a.kind==='erc1155')return c.readContract({address:a.contract!,abi:tokenAbi,functionName:'balanceOf',args:[wallet,a.tokenId!],blockNumber:block});
 return c.readContract({address:a.contract!,abi:tokenAbi,functionName:'balanceOf',args:[wallet],blockNumber:block});
}
export async function importAsset(c:Client,s:Snapshot,kind:'erc20'|'erc721'|'erc1155',contract:Address,tokenId?:bigint,source='Imported'):Promise<Asset>{
 if([s.wallet,s.implementation,s.entryPoint].some(a=>same(a,contract)))throw Error('Wallet, implementation and EntryPoint addresses cannot be imported as tokens.');
 if(!await c.getCode({address:contract})||await c.getCode({address:contract})==='0x')throw Error('No token contract is deployed at this address.');
 if(kind!=='erc20'&&(tokenId===undefined||tokenId<0n))throw Error('Enter a nonnegative NFT token ID.');
 if(kind!=='erc20'){const supported=await c.readContract({address:contract,abi:tokenAbi,functionName:'supportsInterface',args:[kind==='erc721'?'0x80ac58cd':'0xd9b67a26']});if(!supported)throw Error(`The contract does not report ${kind==='erc721'?'ERC-721':'ERC-1155'} support.`);}
 const [symbol,name,decimals]=await Promise.all([
 c.readContract({address:contract,abi:tokenAbi,functionName:'symbol'}).catch(()=>kind==='erc20'?'TOKEN':'NFT'),
 c.readContract({address:contract,abi:tokenAbi,functionName:'name'}).catch(()=>kind==='erc20'?'Imported token':'Imported NFT'),
 kind==='erc20'?c.readContract({address:contract,abi:tokenAbi,functionName:'decimals'}):Promise.resolve(0),
 ]);
 if(decimals<0||decimals>36)throw Error('Unsupported or missing token decimals.');
 const a:Asset={key:assetKey(kind,contract,tokenId),kind,contract,tokenId,symbol:String(symbol).slice(0,30),name:String(name).slice(0,100),decimals,balance:0n,source};a.balance=await holding(c,s.wallet,a);return a;
}
export async function discover(c:Client,s:Snapshot,n:Network):Promise<{assets:Asset[];note:string}>{
 if(!n.indexer)return {assets:[],note:'This chain has no built-in asset indexer. Import tokens or scan an incoming-transfer block range below. Discovery is incomplete.'};
 const candidates:{kind:'erc20'|'erc721'|'erc1155';contract:Address;id?:bigint}[]=[];const warnings:string[]=[];
 const get=async(path:string)=>{const r=await fetch(n.indexer+'/api/v2/'+path,{signal:AbortSignal.timeout(22000)});if(!r.ok)throw Error(`Indexer returned ${r.status}`);return r.json()};
 try{const balances=await get(`addresses/${s.wallet}/token-balances`);for(const b of balances){if(b.token?.type==='ERC-20')candidates.push({kind:'erc20',contract:address(b.token.address_hash)});else if(b.token?.type==='ERC-1155'&&b.token_id!==null)candidates.push({kind:'erc1155',contract:address(b.token.address_hash),id:BigInt(b.token_id)});}}catch(e){warnings.push('Token discovery failed: '+errorText(e));}
 try{let params=new URLSearchParams({type:'ERC-721,ERC-1155'});for(let page=0;page<20;page++){
  const data=await get(`addresses/${s.wallet}/nft?${params}`);for(const item of data.items||[]){const kind=item.token?.type==='ERC-1155'?'erc1155':'erc721';if(item.id!==undefined&&item.token?.address_hash)candidates.push({kind,contract:address(item.token.address_hash),id:BigInt(item.id)});}
  if(!data.next_page_params)break;if(page===19)warnings.push('NFT discovery reached 20 pages; more NFTs may exist.');params=new URLSearchParams({...data.next_page_params,type:'ERC-721,ERC-1155'});
 }}catch(e){warnings.push('NFT discovery failed: '+errorText(e));}
 const unique=[...new Map(candidates.map(a=>[assetKey(a.kind,a.contract,a.id),a])).values()];const assets:Asset[]=[];let failed=0;
 for(let start=0;start<unique.length;start+=5){const results=await Promise.allSettled(unique.slice(start,start+5).map(a=>importAsset(c,s,a.kind,a.contract,a.id,'Blockscout + on-chain')));for(const r of results){if(r.status==='fulfilled'){if(r.value.balance>0n)assets.push(r.value)}else failed++;}}
 if(failed)warnings.push(`${failed} discovered assets could not be verified; import them individually to inspect the error.`);
 return {assets,note:[`Found ${assets.length} token/NFT holdings and checked their balances on-chain. Indexers can miss assets; imports remain available.`,...warnings].join(' ')};
}
export async function scanTransfers(c:Client,s:Snapshot,from:bigint,to:bigint,onProgress:(text:string)=>void):Promise<{assets:Asset[];note:string}>{
 if(from<0n||to<from||to-from>100000n)throw Error('Choose a range of at most 100,000 blocks. Repeat with earlier ranges to find older transfers.');
 if(to>await c.getBlockNumber())throw Error('The ending block is in the future.');
 const incoming=pad(s.wallet,{size:32});const topics=['Transfer(address,address,uint256)','TransferSingle(address,address,address,uint256,uint256)','TransferBatch(address,address,address,uint256[],uint256[])'].map(sig=>keccak256(toBytes(sig)));
 const found=new Map<string,{kind:'erc20'|'erc721'|'erc1155';contract:Address;id?:bigint}>();
 for(let lo=from;lo<=to;lo+=2000n){const hi=lo+1999n>to?to:lo+1999n;onProgress(`Scanning blocks ${lo}–${hi}…`);
  const query=async(topic:Hex,nft:boolean)=>c.request({method:'eth_getLogs',params:[{fromBlock:toHex(lo),toBlock:toHex(hi),topics:nft?[topic,null,null,incoming]:[topic,null,incoming]}]});
  const responses=await Promise.all([query(topics[0],false),query(topics[1],true),query(topics[2],true)]);
  for(const log of responses.flat()){
   const contract=address(log.address);if(log.topics[0]===topics[0]){const kind=log.topics.length===4?'erc721':'erc20';const id=kind==='erc721'?BigInt(log.topics[3]!):undefined;found.set(assetKey(kind,contract,id),{kind,contract,id});}
   else {const event=decodeEventLog({abi:tokenAbi,data:log.data,topics:log.topics as [Hex,...Hex[]]});if(event.eventName==='TransferSingle'){const id=event.args.id;found.set(assetKey('erc1155',contract,id),{kind:'erc1155',contract,id});}else if(event.eventName==='TransferBatch')for(const id of event.args.ids)found.set(assetKey('erc1155',contract,id),{kind:'erc1155',contract,id});}
  }
 }
 const assets:Asset[]=[];let failed=0;const list=[...found.values()];for(let start=0;start<list.length;start+=5){onProgress(`Checking holdings ${start+1}–${Math.min(start+5,list.length)} of ${list.length}…`);const results=await Promise.allSettled(list.slice(start,start+5).map(x=>importAsset(c,s,x.kind,x.contract,x.id,'Transfer logs + on-chain')));for(const r of results)if(r.status==='fulfilled'){if(r.value.balance>0n)assets.push(r.value)}else failed++;}
 return {assets,note:`Scanned incoming transfers in blocks ${from}–${to}; found ${assets.length} current holdings. Assets received outside this range or without standard events may be missing.${failed?' '+failed+' token checks failed.':''}`};
}
export function buildRecovery(s:Snapshot,recipient:Address,selections:Selection[]):{calls:Call[];data:Hex}{
 assertTrusted(s);if(selections.length===0)throw Error('Select at least one asset.');if(selections.length>100)throw Error('Select at most 100 assets per transaction to stay within practical gas limits.');
 if(same(recipient,s.wallet)||/^0x0{40}$/i.test(recipient))throw Error('Choose a nonzero recipient different from the wallet.');
 if(new Set(selections.map(x=>x.asset.key)).size!==selections.length)throw Error('Duplicate asset selection.');
 const calls=selections.map(({asset:a,amount}):Call=>{
  if(amount<=0n||amount>a.balance)throw Error('Invalid or excessive transfer amount.');
  if(a.kind==='native')return {target:recipient,value:amount,data:'0x'};
  if(a.kind==='deposit'){if(s.deposit===null||amount>s.deposit)throw Error('EntryPoint deposit is unavailable or insufficient.');return {target:s.entryPoint,value:0n,data:encodeFunctionData({abi:entryAbi,functionName:'withdrawTo',args:[recipient,amount]})};}
  if(!a.contract||[s.wallet,s.entryPoint,s.implementation].some(x=>same(x,a.contract!)))throw Error('Invalid token target.');
  if(a.kind==='erc20')return {target:a.contract,value:0n,data:encodeFunctionData({abi:tokenAbi,functionName:'transfer',args:[recipient,amount]})};
  if(a.tokenId===undefined||a.tokenId<0n)throw Error('Missing or invalid NFT token ID.');
  if(a.kind==='erc721'){if(amount!==1n)throw Error('ERC-721 amount must be one.');return {target:a.contract,value:0n,data:encodeFunctionData({abi:tokenAbi,functionName:'safeTransferFrom',args:[s.wallet,recipient,a.tokenId]})};}
  return {target:a.contract,value:0n,data:encodeFunctionData({abi:tokenAbi,functionName:'safeTransferFrom',args:[s.wallet,recipient,a.tokenId,amount,'0x']})};
 });return {calls,data:encodeFunctionData({abi:walletAbi,functionName:'executeBatch',args:[calls]})};
}
export async function simulateRecovery(c:Client,s:Snapshot,from:Address,recipient:Address,selections:Selection[]){
 const built=buildRecovery(s,recipient,selections);const notes:string[]=[];
 for(let i=0;i<selections.length;i++){
  const {asset,amount}=selections[i];const available=asset.kind==='deposit'?s.deposit:await holding(c,s.wallet,asset);if(available===null||available<amount)throw Error(`${asset.symbol} balance changed or is insufficient. Refresh holdings.`);
  if(asset.kind==='erc20'){const call=built.calls[i];const result=await c.call({account:s.wallet,to:call.target,data:call.data});const ret=result.data;
   if(ret&&ret!=='0x'){if(ret.length!==66||BigInt(ret)!==1n)throw Error(`${asset.symbol} transfer simulation did not return true. This asset cannot be included.`);}else notes.push(`${asset.symbol} has a nonstandard returnless transfer; verify the recipient balance after confirmation.`);
  }
 }
 await c.call({account:from,to:s.wallet,data:built.data});return {...built,notes};
}
