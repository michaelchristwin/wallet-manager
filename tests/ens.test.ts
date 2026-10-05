import {describe,it,expect,vi} from 'vitest';
import {getAddress,zeroAddress} from 'viem';
import {resolveAddress,verifiedName,assertNameUnchanged,normalizedName,type EnsReader} from '../src/ens';
const a=getAddress('0x1111111111111111111111111111111111111111'),b=getAddress('0x2222222222222222222222222222222222222222');
const reader=():EnsReader=>({getEnsAddress:vi.fn().mockResolvedValue(a),getEnsName:vi.fn().mockResolvedValue('backup.eth')});
describe('ENS address safety',()=>{
 it('normalizes names and resolves the Ethereum address record',async()=>{const r=reader();expect(await resolveAddress(' BACKUP.eth ',r)).toEqual({name:'backup.eth',address:a});expect(r.getEnsAddress).toHaveBeenCalledWith({name:'backup.eth'})});
 it('accepts addresses without making ENS requests',async()=>{const r=reader();expect(await resolveAddress(a,r)).toEqual({address:a});expect(r.getEnsAddress).not.toHaveBeenCalled()});
 it.each([null,zeroAddress])('rejects missing or zero records',async value=>{const r=reader();vi.mocked(r.getEnsAddress).mockResolvedValue(value);await expect(resolveAddress('backup.eth',r)).rejects.toThrow('No Ethereum address record')});
 it('shows actionable lookup failures instead of guessing an address',async()=>{const r=reader();vi.mocked(r.getEnsAddress).mockRejectedValue(Error('RPC'));await expect(resolveAddress('backup.eth',r)).rejects.toThrow('lookup failed')});
 it.each(['https://backup.eth','not an address','bad name.eth'])('rejects invalid input %s',input=>expect(()=>normalizedName(input)).toThrow());
 it('only displays a reverse name whose forward record matches',async()=>{const r=reader();expect(await verifiedName(a,r)).toBe('backup.eth');vi.mocked(r.getEnsAddress).mockResolvedValue(b);expect(await verifiedName(a,r)).toBeNull()});
 it('blocks a name that changed after the transaction preview',async()=>{const r=reader();vi.mocked(r.getEnsAddress).mockResolvedValue(b);await expect(assertNameUnchanged({name:'backup.eth',address:a},r)).rejects.toThrow('changed after your preview')});
 it('allows an unchanged name and does not re-resolve raw addresses',async()=>{const r=reader();await assertNameUnchanged({name:'backup.eth',address:a},r);await assertNameUnchanged({address:a},r);expect(r.getEnsAddress).toHaveBeenCalledTimes(1)});
});
