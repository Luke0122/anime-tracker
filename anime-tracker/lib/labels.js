'use strict';

const STATUS_LABELS = {
  watching: '在看',
  completed: '看完',
  dropped: '弃番',
  on_hold: '搁置',
  plan: '想看',
};

const DAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const WEEKDAY_TO_NUM = {
  '周日': 0, '周一': 1, '周二': 2, '周三': 3, '周四': 4, '周五': 5, '周六': 6,
};

module.exports = { STATUS_LABELS, DAY_LABELS, WEEKDAY_TO_NUM };
