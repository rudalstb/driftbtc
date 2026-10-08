"""수익률(점 예측) 모델과 변동성(구간 예측) 모델.

모든 모델은 같은 인터페이스를 따른다:
    fit(X_train, y_train) -> self
    predict(X) -> 다음 캔들 로그수익률 예측 (np.ndarray)
"""
from __future__ import annotations

import warnings

import lightgbm as lgb
import numpy as np
import pandas as pd
from arch import arch_model
from sklearn.linear_model import RidgeCV
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


class Naive:
    """다음 가격 = 현재 가격 (무작위 행보). 모든 모델이 넘어야 할 기준선."""
    name = "naive"

    def fit(self, X, y):
        return self

    def predict(self, X):
        return np.zeros(len(X))


class Drift:
    """최근 장기 평균 수익률이 이어진다고 가정."""
    name = "drift"

    def __init__(self, col: str, window: int):
        self.col, self.window = col, window

    def fit(self, X, y):
        return self

    def predict(self, X):
        return (X[self.col] / self.window).fillna(0).to_numpy()


class Ridge:
    name = "ridge"

    def fit(self, X, y):
        self.m = make_pipeline(StandardScaler(), RidgeCV(alphas=np.logspace(-1, 5, 13)))
        self.m.fit(X, y)
        return self

    def predict(self, X):
        return self.m.predict(X)


class LGBM:
    name = "lgbm"

    def __init__(self, min_child_samples: int = 100):
        self.params = dict(
            n_estimators=300, learning_rate=0.02, num_leaves=15, max_depth=4,
            min_child_samples=min_child_samples, subsample=0.8, subsample_freq=1,
            colsample_bytree=0.8, reg_lambda=1.0, verbose=-1,
        )

    def fit(self, X, y):
        self.m = lgb.LGBMRegressor(**self.params)
        self.m.fit(X, y)
        return self

    def predict(self, X):
        return self.m.predict(X)


def ewma_sigma(ret: pd.Series, lam: float = 0.94) -> pd.Series:
    """RiskMetrics EWMA. t 시점 값 = t+1 수익률의 표준편차 예측."""
    var = (ret.fillna(0) ** 2).ewm(alpha=1 - lam, adjust=False).mean()
    return np.sqrt(var)


def garch_sigma(ret: pd.Series, fit_end, pred_index, max_obs: int = 10000) -> pd.Series:
    """fit_end 이전 데이터로 GARCH(1,1)-t 를 적합하고, 파라미터를 고정한 채
    pred_index 각 시점에서 다음 캔들 표준편차를 예측한다."""
    r = ret.dropna() * 100
    train = r[r.index < fit_end].iloc[-max_obs:]
    data = r[r.index >= train.index[0]]
    am = arch_model(data, mean="Zero", vol="GARCH", p=1, q=1, dist="t", rescale=False)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        res = am.fit(last_obs=fit_end, disp="off")
        fc = res.forecast(start=pred_index[0], horizon=1, reindex=False)
    sigma = np.sqrt(fc.variance["h.1"]) / 100
    return sigma.reindex(pred_index)
