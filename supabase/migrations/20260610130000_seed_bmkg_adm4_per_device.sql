-- ADM4 BMKG per titik pantau (Bojong Kulur deployment)

UPDATE sijagakali.device_configs
SET bmkg_adm4 = '32.01.32.2003'
WHERE deployment_slug = 'sijagakali-bojong-kulur' AND device_id = 'node-001';

UPDATE sijagakali.device_configs
SET bmkg_adm4 = '32.01.02.2009'
WHERE deployment_slug = 'sijagakali-bojong-kulur' AND device_id = 'node-002';

UPDATE sijagakali.device_configs
SET bmkg_adm4 = '32.01.02.2002'
WHERE deployment_slug = 'sijagakali-bojong-kulur' AND device_id = 'node-003';
