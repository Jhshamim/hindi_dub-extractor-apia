import axios from 'axios';

async function test() {
  try {
    const res = await axios.get('https://extract.streamindia.co.in/cache/8757150decbd89b0f5442ca3db4d0e0e/hin_master.m3u8');
    console.log(res.data);
  } catch (e) {
    console.error(e.response ? e.response.data : e.message);
  }
}

test();
