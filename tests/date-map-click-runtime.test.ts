import test from 'node:test';
import assert from 'node:assert/strict';
import { matchClickedSearchPlace } from '../src/utils/dateMapClick.ts';

const gangnam = { latitude: 37.49710, longitude: 127.02870, placeName: '니뽕내뽕 강남점', address: '서울 강남구' };
const hongdae = { latitude: 37.55540, longitude: 126.92270, placeName: '니뽕내뽕 홍대점', address: '서울 마포구' };

test('tap near searched 니뽕내뽕 uses that branch and does not substitute another branch', () => {
  assert.equal(matchClickedSearchPlace({ latitude: 37.49715, longitude: 127.02873 }, [hongdae, gangnam]), gangnam);
  assert.equal(matchClickedSearchPlace({ latitude: 37.55545, longitude: 126.92273 }, [hongdae, gangnam]), hongdae);
});

test('base map tap without a matching search result never guesses a business name', () => {
  assert.equal(matchClickedSearchPlace({ latitude: 37.570, longitude: 127.031 }, [hongdae, gangnam]), null);
  assert.equal(matchClickedSearchPlace({ latitude: 37.4971, longitude: 127.0287 }, []), null);
});

test('ambiguous map click between two nearby branches requires manual confirmation', () => {
  const another = { ...gangnam, latitude: gangnam.latitude + 0.00009, placeName: '다른 가게' };
  assert.equal(matchClickedSearchPlace({ latitude: gangnam.latitude + 0.000045, longitude: gangnam.longitude }, [gangnam, another]), null);
});
