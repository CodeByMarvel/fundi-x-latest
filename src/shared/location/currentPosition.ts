import Geolocation from '@react-native-community/geolocation';
import { PermissionsAndroid, Platform } from 'react-native';
import { Coordinates } from '../../domain/jobs/request';

/** Location is off, or the person said no. The message says what to do. */
export class LocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocationError';
    Object.setPrototypeOf(this, LocationError.prototype);
  }
}

/** Asks for location permission once; true if we have it. */
async function permitted(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const fine = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
    if (await PermissionsAndroid.check(fine)) {
      return true;
    }
    return (await PermissionsAndroid.request(fine)) === PermissionsAndroid.RESULTS.GRANTED;
  }
  return new Promise(resolve =>
    Geolocation.requestAuthorization(
      () => resolve(true),
      () => resolve(false),
    ),
  );
}

/**
 * Where the phone is now (GPS, or the network when GPS is slow). Accepts
 * a fix up to 15 s old, so a report every 30 s doesn't wake GPS twice.
 * `purpose` finishes the sentence "Turn on location to …".
 */
export async function currentPosition(purpose = 'go online'): Promise<Coordinates> {
  if (!(await permitted())) {
    throw new LocationError(`Allow Fundi-X to use your location to ${purpose}.`);
  }
  return new Promise((resolve, reject) =>
    Geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      () => reject(new LocationError(`Turn on location to ${purpose}.`)),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 15_000 },
    ),
  );
}
