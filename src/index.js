import snmp from 'net-snmp';

const PLUGIN_NAME = 'homebridge-monigear-snmp';
const PLATFORM_NAME = 'MonigearSNMP';

/**
 * Monigear enterprise OID tree (.1.3.6.1.4.1.22853)
 *
 * Supported devices:
 *   MN-NTHM  — Temperature + Humidity (PoE Ethernet)
 *   MN-WTHM  — Temperature + Humidity (WiFi)
 *   MN-NCO2TH — CO2 + Temperature + Humidity
 *   MN-NVOC  — CO2 + Temperature + Humidity + TVOC
 */
const OID = {
  productName: '1.3.6.1.4.1.22853.1.1.1.0',
  numAIO: '1.3.6.1.4.1.22853.1.1.3.0',
  aioValue: (index) => `1.3.6.1.4.1.22853.1.3.1.2.${index}`,
  aioDetail: (index) => `1.3.6.1.4.1.22853.1.3.1.7.${index}`,
  aioName: (index) => `1.3.6.1.4.1.22853.1.3.1.6.${index}`,
};

export default (api) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, MonigearPlatform);
};

class MonigearPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.cachedAccessories = [];
    this.sensors = [];

    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    if (!this.config.host) {
      this.log.error('No host configured. Please set the sensor IP/IPv6 address in the plugin config.');
      return;
    }

    this.log.info('Monigear SNMP platform initializing...');

    api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });

    api.on('shutdown', () => {
      for (const sensor of this.sensors) {
        sensor.destroy();
      }
    });
  }

  configureAccessory(accessory) {
    this.log.info(`Restoring cached accessory: ${accessory.displayName}`);
    this.cachedAccessories.push(accessory);
  }

  discoverDevices() {
    // Support single sensor config or 'devices' array for multi-sensor
    const devices = this.config.devices || [{
      name: this.config.name || 'MN-NTHM',
      host: this.config.host,
      port: this.config.port || 161,
      community: this.config.community || 'public',
      pollInterval: this.config.pollInterval || 30,
    }];

    for (const deviceConfig of devices) {
      if (!deviceConfig.host) {
        this.log.warn(`Skipping device "${deviceConfig.name}" — no host configured`);
        continue;
      }
      const sensor = new MonigearSensor(this, deviceConfig);
      this.sensors.push(sensor);
    }
  }
}

class MonigearSensor {
  constructor(platform, config) {
    this.platform = platform;
    this.log = platform.log;
    this.api = platform.api;
    this.Service = platform.Service;
    this.Characteristic = platform.Characteristic;

    this.name = config.name || 'Monigear Sensor';
    this.host = config.host;
    this.port = config.port || 161;
    this.community = config.community || 'public';
    this.pollInterval = (config.pollInterval || 30) * 1000;

    this.temperature = null;
    this.humidity = null;
    this.active = false;
    this.session = null;
    this._pollTimer = null;
    this.accessory = null;

    this.log.info(`[${this.name}] Connecting to ${this.host}:${this.port} (community: ${this.community}, interval: ${this.pollInterval / 1000}s)`);

    this.registerAccessory();
    this.createSession();
    this.startPolling();
  }

  registerAccessory() {
    const uuid = this.api.hap.uuid.generate(`monigear-snmp-${this.host}-${this.port}`);

    let accessory = this.platform.cachedAccessories.find(a => a.UUID === uuid);

    if (!accessory) {
      this.log.info(`[${this.name}] Registering new accessory`);
      accessory = new this.api.platformAccessory(this.name, uuid);
      this.setupServices(accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    } else {
      this.log.info(`[${this.name}] Restoring from cache`);
      this.setupServices(accessory);
    }

    this.accessory = accessory;
  }

  setupServices(accessory) {
    // Accessory Information
    accessory.getService(this.Service.AccessoryInformation)
      .setCharacteristic(this.Characteristic.Manufacturer, 'Monigear')
      .setCharacteristic(this.Characteristic.Model, 'MN-NTHM')
      .setCharacteristic(this.Characteristic.SerialNumber, this.host.replace(/%.*$/, '').slice(-17))
      .setCharacteristic(this.Characteristic.FirmwareRevision, '1.0.0');

    // Temperature Sensor
    const tempService = accessory.getService(this.Service.TemperatureSensor) ||
      accessory.addService(this.Service.TemperatureSensor, `${this.name} Temperature`);

    tempService.getCharacteristic(this.Characteristic.CurrentTemperature)
      .setProps({ minValue: -30, maxValue: 85 })
      .onGet(() => {
        if (this.temperature === null) {
          throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
        return this.temperature;
      });

    tempService.getCharacteristic(this.Characteristic.StatusActive)
      .onGet(() => this.active);

    // Humidity Sensor
    const humService = accessory.getService(this.Service.HumiditySensor) ||
      accessory.addService(this.Service.HumiditySensor, `${this.name} Humidity`);

    humService.getCharacteristic(this.Characteristic.CurrentRelativeHumidity)
      .onGet(() => {
        if (this.humidity === null) {
          throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
        return this.humidity;
      });

    humService.getCharacteristic(this.Characteristic.StatusActive)
      .onGet(() => this.active);
  }

  createSession() {
    const isIPv6 = this.host.includes(':');
    const opts = {
      port: this.port,
      version: snmp.Version2c,
      timeout: 5000,
      retries: 1,
    };
    if (isIPv6) opts.transport = 'udp6';

    this.session = snmp.createSession(this.host, this.community, opts);
    this.session.on('error', (err) => {
      this.log.error(`[${this.name}] SNMP error: ${err.message}`);
    });
  }

  startPolling() {
    this.poll();
  }

  destroy() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    if (this.session) {
      this.session.close();
      this.session = null;
    }
  }

  async poll() {
    try {
      const reading = await this.getReading();
      this.temperature = reading.temperature;
      this.humidity = reading.humidity;

      if (!this.active) {
        this.log.info(`[${this.name}] Sensor online: ${this.temperature}°C, ${this.humidity}%RH`);
      }
      this.active = true;

      this.log.debug(`[${this.name}] ${this.temperature}°C, ${this.humidity}%RH`);
    } catch (err) {
      if (this.active) {
        this.log.warn(`[${this.name}] Sensor offline: ${err.message}`);
      }
      this.active = false;
    }

    this.pushUpdates();
    this._pollTimer = setTimeout(() => this.poll(), this.pollInterval);
  }

  pushUpdates() {
    if (!this.accessory) return;

    const tempService = this.accessory.getService(this.Service.TemperatureSensor);
    if (tempService) {
      if (this.temperature !== null) {
        tempService.updateCharacteristic(this.Characteristic.CurrentTemperature, this.temperature);
      }
      tempService.updateCharacteristic(this.Characteristic.StatusActive, this.active);
    }

    const humService = this.accessory.getService(this.Service.HumiditySensor);
    if (humService) {
      if (this.humidity !== null) {
        humService.updateCharacteristic(this.Characteristic.CurrentRelativeHumidity, this.humidity);
      }
      humService.updateCharacteristic(this.Characteristic.StatusActive, this.active);
    }
  }

  getReading() {
    return new Promise((resolve, reject) => {
      if (!this.session) return reject(new Error('No SNMP session'));

      const oids = [OID.aioValue(1), OID.aioValue(2), OID.aioDetail(1)];

      this.session.get(oids, (err, varbinds) => {
        if (err) return reject(err);

        for (const vb of varbinds) {
          if (snmp.isVarbindError(vb)) {
            return reject(new Error(snmp.varbindError(vb)));
          }
        }

        let temperature = parseFloat(varbinds[0].value.toString());
        const humidity = parseFloat(varbinds[1].value.toString());
        const detail = varbinds[2].value.toString();

        if (isNaN(temperature) || isNaN(humidity)) {
          return reject(new Error('Invalid sensor data'));
        }

        // Auto-detect Fahrenheit from detail string (e.g., "78.1°F") and convert to Celsius
        if (detail.includes('F')) {
          temperature = (temperature - 32) * 5 / 9;
        }

        resolve({
          temperature: Math.round(temperature * 10) / 10,
          humidity: Math.round(humidity * 10) / 10,
        });
      });
    });
  }
}
