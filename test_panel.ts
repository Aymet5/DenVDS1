import axios from 'axios';
import https from 'https';

const agent = new https.Agent({ rejectUnauthorized: false });
const url = 'https://108.165.32.63:3009/3MR4tN4z0zzJVyj5JF/';

async function test() {
  const params = new URLSearchParams();
  params.append('username', 'admin');
  params.append('password', 'Solbon5796+-');
  const res = await axios.post(url + 'login', params, { httpsAgent: agent });
  const cookie = res.headers['set-cookie'][0];
  const inbounds = await axios.get(url + 'panel/api/inbounds/list', { headers: { Cookie: cookie }, httpsAgent: agent });
  console.log("INBOUNDS:", inbounds.data.obj.map((i: any) => i.id));
}
test().catch(console.error);
