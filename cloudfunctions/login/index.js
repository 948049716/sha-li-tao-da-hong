'use strict';
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const col = db.collection('users');
  const found = await col.where({ _openid: OPENID }).limit(1).get();
  if (found.data && found.data.length > 0) {
    const doc = found.data[0];
    return {
      openid: OPENID,
      profile: doc.profile || null,
      cloudSave: doc.save || null,
    };
  }
  const suffix = OPENID ? OPENID.slice(-4).toUpperCase() : String(Math.floor(1000 + Math.random() * 9000));
  const defaultProfile = {
    openid: OPENID,
    nickName: `摸金新人_${suffix}`,
    avatarUrl: '',
    isAuthorized: false,
  };
  await col.add({
    data: {
      _openid: OPENID,
      profile: defaultProfile,
      save: null,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });
  return { openid: OPENID, profile: defaultProfile, cloudSave: null };
};
