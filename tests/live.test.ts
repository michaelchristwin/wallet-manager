import {it,expect} from 'vitest';
import {encodeFunctionData,getAddress} from 'viem';
import {inspect,assertSameOwners} from '../src/wallet';
import {clientFor,DEFAULT_WALLET,NETWORKS} from '../src/chain';
import {walletAbi} from '../src/abi';
import {baseAssets,simulateRecovery} from '../src/assets';
const run=(globalThis as {process?:{env:Record<string,string|undefined>}}).process?.env.RUN_LIVE==='1'?it:it.skip;
for(const id of [1,8453,10,42161,137,56])run(`read-only live simulation on chain ${id} preserves owners`,async()=>{
 const n=NETWORKS.find(n=>n.chain.id===id)!;const s=await inspect(n,DEFAULT_WALLET);expect(s.verified).toBe(true);expect(s.owners).toHaveLength(2);const actor=s.owners.find(o=>o.address)!.address!;const recipient=getAddress('0x2222222222222222222222222222222222222222');const c=clientFor(n);
 await c.call({account:actor,to:s.wallet,data:encodeFunctionData({abi:walletAbi,functionName:'addOwnerAddress',args:[recipient]})});
 const selected=baseAssets(s,n).filter(a=>a.balance>0n).map(asset=>({asset,amount:asset.balance}));if(selected.length)await simulateRecovery(c,s,actor,recipient,selected);
 const after=await inspect(n,DEFAULT_WALLET);assertSameOwners(s,after);expect(after.count).toBe(2n);
},120000);
