'use strict';
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async event => {
  const { OPENID } = cloud.getWXContext();
  const incoming = event && event.save;
  if (!incoming || typeof incoming !== 'object') {
    return { ok: false, reason: 'invalid_save' };
  }
  const col = db.collection('users');
  const found = await col.where({ _openid: OPENID }).limit(1).get();
  if (found.data && found.data.length > 0) {
    await col.doc(found.data[0]._id).update({
      data: {
        save: incoming,
        updatedAt: db.serverDate(),
      },
    });
  } else {
    await col.add({
      data: {
        _openid: OPENID,
        save: incoming,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });
  }
  return { ok: true };
};
