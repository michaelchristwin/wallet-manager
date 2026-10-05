import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();await page.goto('http://localhost:5173');await page.getByRole('heading',{name:'Current owners'}).waitFor();
 const resolved=await page.evaluate(async()=>{const {resolveAddress,verifiedName}=await import('/src/ens.ts');const result=await resolveAddress('bankless.ichristwin.eth');return {...result,reverse:await verifiedName(result.address)}});
 if(resolved.address!=='0xbEC9C3d164E2E8C640dc8efC330E92bafA6e7b07'||resolved.reverse!=='bankless.ichristwin.eth')throw Error('Live ENS lookup mismatch');console.log('Ethereum ENS forward and verified reverse:',resolved);
 await page.waitForFunction(()=>!document.querySelector('main [role="status"] .spinner'),{timeout:60000});await page.getByLabel('Smart wallet address or ENS name',{exact:true}).fill('bankless.ichristwin.eth');await page.getByRole('button',{name:'Inspect wallet',exact:true}).click();await page.getByText('Passkey public key',{exact:true}).waitFor({timeout:60000});if(!await page.getByText('Address owner',{exact:true}).isVisible())throw Error('ENS wallet inspection failed');console.log('ENS wallet input inspected successfully');
 await page.getByRole('button',{name:'Connect wallet',exact:true}).click();const popupPromise=page.waitForEvent('popup',{timeout:20000});await page.getByRole('button',{name:'Coinbase / Base Account',exact:true}).click();const popup=await popupPromise;await popup.waitForURL(/https:\/\/keys\.coinbase\.com\/connect/,{timeout:20000});console.log('Official SDK opened its Coinbase account connection popup:',new URL(popup.url()).origin);await popup.close();
}finally{await browser.close()}
