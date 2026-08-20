# homebridge-monigear-snmp

[![Homebridge](https://img.shields.io/badge/homebridge-plugin-blue)](https://homebridge.io)

Homebridge plugin for **Monigear** network temperature, humidity, and air quality sensors via SNMP V2c.

Exposes your Monigear sensors as native HomeKit accessories — temperature and humidity readings appear in the Home app, Siri queries, and automations.

## Supported Devices

| Model | Sensors | Interface |
|-------|---------|-----------|
| MN-NTHM | Temperature + Humidity | PoE Ethernet |
| MN-WTHM | Temperature + Humidity | WiFi |
| MN-NCO2TH | CO2 + Temperature + Humidity | PoE Ethernet |
| MN-NVOC | CO2 + Temperature + Humidity + TVOC | PoE Ethernet |

## Features

- SNMP V2c communication (no cloud, no proprietary config tool needed)
- IPv4 and IPv6 link-local support
- Auto-detects °F/°C from device and normalizes to Celsius for HomeKit
- Multiple sensors per platform instance
- Configurable poll interval (5–300 seconds)
- Shows "Not Responding" in HomeKit when sensor is unreachable
- Homebridge Config UI support

## Installation

### From GitHub

```bash
npm install -g github:YOUR_USERNAME/homebridge-monigear-snmp
```

### From npm (if published)

```bash
npm install -g homebridge-monigear-snmp
```

### Or via Homebridge UI

Search for `homebridge-monigear-snmp` in the Homebridge plugins tab.

## Configuration

### Single Sensor (simple)

```json
{
  "platforms": [
    {
      "platform": "MonigearSNMP",
      "name": "Office Sensor",
      "host": "fe80::2bd:3bff:fe00:4cd1%en0",
      "port": 161,
      "community": "public",
      "pollInterval": 30
    }
  ]
}
```

### Multiple Sensors

```json
{
  "platforms": [
    {
      "platform": "MonigearSNMP",
      "name": "Monigear Sensors",
      "devices": [
        {
          "name": "Office",
          "host": "fe80::2bd:3bff:fe00:4cd1%en0",
          "port": 161,
          "community": "public",
          "pollInterval": 30
        },
        {
          "name": "Server Room",
          "host": "192.168.1.50",
          "community": "public",
          "pollInterval": 10
        }
      ]
    }
  ]
}
```

### Options

| Field | Default | Description |
|-------|---------|-------------|
| `platform` | `"MonigearSNMP"` | Must be exactly this |
| `name` | `"MN-NTHM"` | Sensor name in HomeKit (single-sensor mode) |
| `host` | — | **Required.** IPv4, IPv6, or link-local with interface |
| `port` | `161` | SNMP UDP port |
| `community` | `"public"` | SNMP V2c read community string |
| `pollInterval` | `30` | Seconds between SNMP polls |
| `devices` | — | Array of sensor configs (overrides top-level host/port/community) |

## Finding Your Sensor's Address

### IPv4

If the sensor has an IPv4 address on your subnet (check the LCD screen or your router's DHCP table):
```
"host": "192.168.1.50"
```

### IPv6 Link-Local

If the sensor has no IPv4 on your subnet (common with factory-default PoE sensors), use its IPv6 link-local address. You can find it in the Monigear app, on the device LCD, or via:

```bash
# Discover link-local devices on your interface
ping6 -c 2 -I en0 ff02::1

# Or check the Monigear app → Device Information → IPv6 address
```

The format is `fe80::XXXX:XXXX:XXXX:XXXX%INTERFACE`:
```
"host": "fe80::2bd:3bff:fe00:4cd1%en0"
```

> **Note:** The `%en0` suffix specifies which network interface to use. Replace `en0` with your actual interface name (`en0` = WiFi on most Macs, `eth0` on Linux/Raspberry Pi).

## SNMP Details

The plugin reads from the Monigear enterprise OID tree (`.1.3.6.1.4.1.22853`):

| OID | Description |
|-----|-------------|
| `.1.3.6.1.4.1.22853.1.3.1.2.1` | Temperature (float string, °C or °F) |
| `.1.3.6.1.4.1.22853.1.3.1.2.2` | Humidity (float string, %RH) |
| `.1.3.6.1.4.1.22853.1.3.1.7.1` | Temperature detail (includes unit, e.g., "25.5°C") |
| `.1.3.6.1.4.1.22853.1.1.1.0` | Product name |

**Defaults:**
- Read community: `public`
- Write community: `monigear`
- Port: `161`

SNMP is enabled by default on all Monigear network sensors.

## Troubleshooting

**"Not Responding" in HomeKit:**
- Verify the sensor is powered and on the network
- Check that the host address is correct (try `ping` or `ping6`)
- Ensure SNMP port 161/UDP is not blocked by a firewall
- Check Homebridge logs for specific error messages

**Sensor shows wrong temperature:**
- The plugin auto-detects °F vs °C from the device. If the sensor is set to °F, the plugin converts to °C automatically (HomeKit requires Celsius).

**IPv6 not working:**
- Ensure the `%interface` suffix matches your actual network interface
- On Raspberry Pi / Linux: use `eth0` or `br0` instead of `en0`
- Verify with: `ping6 -I en0 <your-sensor-ipv6>`

## License

MIT
