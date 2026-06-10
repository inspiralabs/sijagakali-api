export interface BmkgForecastHour {
  localDatetime: string;
  temperatureC: number | null;
  weatherCode: number | null;
  weatherDesc: string;
  humidityPct: number | null;
  windSpeedKmh: number | null;
  windDir: string;
  visibilityText: string;
}

export interface BmkgForecastDay {
  label: string;
  dateLabel: string;
  hours: BmkgForecastHour[];
}

export interface BmkgForecastCurrent {
  temperatureC: number | null;
  weatherCode: number | null;
  weatherDesc: string;
  humidityPct: number | null;
  windSpeedKmh: number | null;
  windDir: string;
  visibilityText: string;
  updatedAt: string;
}

export interface BmkgNormalizedForecast {
  adm4: string;
  location: {
    desa: string;
    kecamatan: string;
    kotkab: string;
    provinsi: string;
  };
  current: BmkgForecastCurrent | null;
  days: BmkgForecastDay[];
  source: 'bmkg';
  fetchedAt: string;
}

