import {defineChain,createPublicClient,http,type Address, type Hex, getAddress, isAddress, zeroAddress} from 'viem';
import {mainnet,base,optimism,arbitrum,polygon,bsc,avalanche,zora} from 'viem/chains';
export const DEFAULT_WALLET=getAddress('0xbec9c3d164e2e8c640dc8efc330e92bafa6e7b07');
export const NETWORKS=[
 {chain:mainnet,rpc:'https://ethereum-rpc.publicnode.com',indexer:'https://eth.blockscout.com',color:'#6579bb'},
 {chain:base,rpc:'https://base-rpc.publicnode.com',indexer:'https://base.blockscout.com',color:'#0052ff'},
 {chain:optimism,rpc:'https://optimism-rpc.publicnode.com',indexer:'https://optimism.blockscout.com',color:'#ed3c51'},
 {chain:arbitrum,rpc:'https://arbitrum-one-rpc.publicnode.com',indexer:'https://arbitrum.blockscout.com',color:'#4197c8'},
 {chain:polygon,rpc:'https://polygon.drpc.org',indexer:'https://polygon.blockscout.com',color:'#8247e5'},
 {chain:bsc,rpc:'https://bsc-rpc.publicnode.com',indexer:undefined,color:'#caa424'},
 {chain:avalanche,rpc:'https://avalanche-c-chain-rpc.publicnode.com',indexer:undefined,color:'#df4547'},
 {chain:zora,rpc:'https://rpc.zora.energy',indexer:'https://explorer.zora.energy',color:'#272bc5'},
 {chain:defineChain({id:33139,name:'ApeChain',nativeCurrency:{name:'ApeCoin',symbol:'APE',decimals:18},rpcUrls:{default:{http:['https://rpc.apechain.com']}},blockExplorers:{default:{name:'ApeScan',url:'https://apescan.io'}}}),rpc:'https://rpc.apechain.com',indexer:undefined,color:'#4884be'},
 {chain:defineChain({id:143,name:'Monad',nativeCurrency:{name:'Monad',symbol:'MON',decimals:18},rpcUrls:{default:{http:['https://rpc.monad.xyz']}},blockExplorers:{default:{name:'MonadScan',url:'https://monadscan.com'}}}),rpc:'https://rpc.monad.xyz',indexer:undefined,color:'#7861bb'},
];
export type Network=typeof NETWORKS[number];
export type Client=ReturnType<typeof clientFor>;
export function clientFor(network:Network,customRpc?:string){
 if(customRpc){const u=new URL(customRpc);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw new Error('Use an HTTPS RPC URL.');}
 return createPublicClient({chain:network.chain,transport:http(customRpc||network.rpc,{timeout:18000,retryCount:1})});
}
export function address(value:string):Address{if(!isAddress(value.trim(),{strict:true}))throw new Error('Enter a valid address. Mixed-case addresses must have a valid checksum.');return getAddress(value.trim());}
export function recipientAddress(value:string,wallet:Address):Address{const a=address(value);if(a===zeroAddress||a===wallet)throw new Error('Choose a nonzero recipient different from the smart wallet.');return a;}
export function same(a:string,b:string){return a.toLowerCase()===b.toLowerCase();}
export function short(a:string){return a.length>20?`${a.slice(0,8)}…${a.slice(-6)}`:a;}
export function errorText(e:unknown){const x=e as {shortMessage?:string;message?:string};return (x?.shortMessage||x?.message||String(e)).slice(0,500);}
export function json(data:unknown){return JSON.stringify(data,(_,v)=>typeof v==='bigint'?v.toString():v,2);}
export function download(name:string,data:unknown){const url=URL.createObjectURL(new Blob([json(data)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export const IMPLEMENTATION_SLOT='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as Hex;
