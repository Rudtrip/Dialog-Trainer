-- Fix media links for the promoted preinstalled character.
-- Safe to run multiple times.

update public.library_assets
set
  source = 'preinstalled',
  workspace_id = null,
  owner_id = null,
  s3_key = null,
  file_url = '/preinstalled/characters/doctor-e0ea2c0e/base.png',
  thumbnail_url = '/preinstalled/characters/doctor-e0ea2c0e/base.png',
  mime_type = 'image/png',
  metadata_json = jsonb_build_object(
    'emotions_count', 4,
    'emotionImages', jsonb_build_object(
      'neutral', '/preinstalled/characters/doctor-e0ea2c0e/emotions/neutral.png',
      'happy', '/preinstalled/characters/doctor-e0ea2c0e/emotions/happy.png',
      'concerned', '/preinstalled/characters/doctor-e0ea2c0e/emotions/neutral.png',
      'angry', '/preinstalled/characters/doctor-e0ea2c0e/emotions/angry.png'
    )
  ),
  updated_at = timezone('utc', now())
where id = 'e0ea2c0e-ea03-4534-b51b-09f014fe3b53'
  and type = 'character';
