import {parseAbi} from 'viem';
export const walletAbi=parseAbi([
 'function implementation() view returns(address)',
 'function nextOwnerIndex() view returns(uint256)',
 'function ownerCount() view returns(uint256)',
 'function ownerAtIndex(uint256 index) view returns(bytes)',
 'function isOwnerAddress(address owner) view returns(bool)',
 'function entryPoint() view returns(address)',
 'function addOwnerAddress(address owner)',
 'function execute(address target,uint256 value,bytes data) payable',
 'function executeBatch((address target,uint256 value,bytes data)[] calls) payable',
 'event AddOwner(uint256 indexed index,bytes owner)',
 'error Unauthorized()',
 'error AlreadyOwner(bytes owner)',
]);
export const tokenAbi=parseAbi([
 'function balanceOf(address owner) view returns(uint256)',
 'function decimals() view returns(uint8)',
 'function symbol() view returns(string)',
 'function name() view returns(string)',
 'function transfer(address to,uint256 amount) returns(bool)',
 'function ownerOf(uint256 tokenId) view returns(address)',
 'function safeTransferFrom(address from,address to,uint256 tokenId)',
 'function safeTransferFrom(address from,address to,uint256 id,uint256 amount,bytes data)',
 'function balanceOf(address account,uint256 id) view returns(uint256)',
 'function supportsInterface(bytes4 interfaceId) view returns(bool)',
 'event Transfer(address indexed from,address indexed to,uint256 value)',
 'event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)',
 'event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values)',
]);
export const entryAbi=parseAbi([
 'function balanceOf(address account) view returns(uint256)',
 'function withdrawTo(address payable withdrawAddress,uint256 withdrawAmount)',
 'function getDepositInfo(address account) view returns((uint112 deposit,bool staked,uint112 stake,uint32 unstakeDelaySec,uint48 withdrawTime) info)',
]);
