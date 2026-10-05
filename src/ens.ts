import {createPublicClient,http,fallback,getAddress,isAddress,zeroAddress,type Address} from 'viem';
import {mainnet} from 'viem/chains';
import {normalize} from 'viem/ens';
import {address,same} from './chain';
export type ResolvedAddress={address:Address;name?:string};
export interface EnsReader{getEnsAddress(args:{name:string}):Promise<Address|null>;getEnsName(args:{address:Address}):Promise<string|null>}
const ensClient=createPublicClient({chain:mainnet,transport:fallback([http('https://ethereum-rpc.publicnode.com',{timeout:12000,retryCount:0}),http('https://eth.drpc.org',{timeout:12000,retryCount:0})])});
export function normalizedName(input:string){const value=input.trim();if(!value.includes('.')||value.includes('/')||/\s/.test(value))throw Error('Enter an Ethereum address or a valid ENS name, such as name.eth.');try{return normalize(value)}catch{throw Error('Invalid ENS name. Check the spelling and characters.')}}
export async function resolveAddress(input:string,reader:EnsReader=ensClient):Promise<ResolvedAddress>{
 const value=input.trim();if(isAddress(value,{strict:true}))return {address:address(value)};
 if(value.startsWith('0x')&&!value.includes('.'))return {address:address(value)};
 const name=normalizedName(value);let resolved:Address|null;try{resolved=await reader.getEnsAddress({name})}catch{throw Error(`ENS lookup failed for ${name}. Retry or use its complete address.`)}
 if(!resolved||same(resolved,zeroAddress))throw Error(`No Ethereum address record was found for ${name}.`);
 return {name,address:getAddress(resolved)};
}
export async function verifiedName(value:Address,reader:EnsReader=ensClient):Promise<string|null>{
 const name=await reader.getEnsName({address:getAddress(value)});if(!name)return null;
 const normalized=normalize(name);const forward=await reader.getEnsAddress({name:normalized});return forward&&same(forward,value)?normalized:null;
}
const names=new Map<string,{expires:number;promise:Promise<string|null>}>();
export function displayName(value:string):Promise<string|null>{
 if(!isAddress(value,{strict:true}))return Promise.resolve(null);const key=value.toLowerCase(),cached=names.get(key);if(cached&&cached.expires>Date.now())return cached.promise;
 const promise=verifiedName(getAddress(value)).catch(()=>null);names.set(key,{expires:Date.now()+120000,promise});return promise;
}
export async function assertNameUnchanged(resolved:ResolvedAddress,reader:EnsReader=ensClient){if(!resolved.name)return;const fresh=await resolveAddress(resolved.name,reader);if(!same(fresh.address,resolved.address))throw Error(`The ENS address for ${resolved.name} changed after your preview. Review the new address before signing.`);}
