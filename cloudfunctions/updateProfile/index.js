'use strict';
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async event => {
  const { OPENID } = cloud.getWXContext();
  const nickName = String((event && event.nickName) || '').slice(0, 32);
  const avatarUrl = String((event && event.avatarUrl) || '').slice(0, 512);
  const col = db.collection('users');
  const found = await col.where({ _openid: OPENID }).limit(1).get();
  const profile = { openid: OPENID, nickName, avatarUrl, isAuthorized: true };
  if (found.data && found.data.length > 0) {
    await col.doc(found.data[0]._id).update({
      data: { profile, updatedAt: db.serverDate() },
    });
  } else {
    await col.add({
      data: { _openid: OPENID, profile, createdAt: db.serverDate(), updatedAt: db.serverDate() },
    });
  }
  return { ok: true };
};
